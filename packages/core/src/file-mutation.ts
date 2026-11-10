export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { dirname } from "path"
import { FileSystemWatcher } from "@coderrupee/schema/filesystem-watcher"
import { FileSystem } from "@coderrupee/schema/filesystem"
import { KeyedMutex } from "./effect/keyed-mutex"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"

export interface Target {
  readonly canonical: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly target: Target
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | FSUtil.Error>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (input: TextWriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | FSUtil.Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@coderrupee/v2/FileMutation") {}

/**
 * Optional app-provided formatter seam invoked after successful mutations.
 * The production adapter maps the coderrupee Format service; absent seams skip
 * formatting.
 */
export interface FormatterInterface {
  readonly file: (filepath: string) => Effect.Effect<boolean>
}

export class Formatter extends Context.Service<Formatter, FormatterInterface>()("@coderrupee/v2/FileMutationFormatter") {}

/**
 * Optional app-provided LSP seam. `afterEdit` touches the file, collects
 * diagnostics, and returns the rendered error block for the file (empty when
 * there are no errors). Implementations log their own failures.
 */
export interface DiagnosticsInterface {
  readonly afterEdit: (file: string) => Effect.Effect<string>
}

export class Diagnostics extends Context.Service<Diagnostics, DiagnosticsInterface>()(
  "@coderrupee/v2/FileMutationDiagnostics",
) {}

export interface Settled {
  /** True when a formatter modified the file after the mutation. */
  readonly formatted: boolean
  /** Rendered LSP error block for the mutated file, empty when none or unavailable. */
  readonly diagnostics: string
}

/**
 * Process-global adapter registry for hosts that compose their runtime without
 * adding nodes to the location graph. Registration happens once at app bootstrap;
 * context services win when both are present.
 */
let globalAdapter:
  | { formatter?: FormatterInterface; diagnostics?: DiagnosticsInterface }
  | undefined

export function registerFileMutationAdapter(adapter: {
  formatter?: FormatterInterface
  diagnostics?: DiagnosticsInterface
}) {
  globalAdapter = { ...globalAdapter, ...adapter }
}

/**
 * Best-effort post-mutation pipeline: format, publish file.edited and watcher
 * events, collect LSP diagnostics. Every step is skipped when its service is
 * absent, so bare Locations and tests need no providers.
 */
export const settle = Effect.fn("FileMutation.settle")(function* (result: WriteResult | RemoveResult) {
  const watcherEvent = result.operation === "remove" ? "unlink" : result.existed ? "change" : "add"
  const events = yield* Effect.serviceOption(EventV2.Service)
  if (Option.isSome(events)) {
    yield* events.value.publish(FileSystem.Event.Edited, { file: result.target })
    yield* events.value.publish(FileSystemWatcher.Event.Updated, { file: result.target, event: watcherEvent })
  }
  if (result.operation === "remove") return { formatted: false, diagnostics: "" }
  const formatter = yield* Effect.serviceOption(Formatter)
  const formatterSource = Option.isSome(formatter) ? formatter.value : globalAdapter?.formatter
  const formatted = formatterSource ? yield* formatterSource.file(result.target) : false
  const lsp = yield* Effect.serviceOption(Diagnostics)
  const diagnosticsSource = Option.isSome(lsp) ? lsp.value : globalAdapter?.diagnostics
  const diagnostics = diagnosticsSource ? yield* diagnosticsSource.afterEdit(result.target) : ""
  return { formatted, diagnostics }
})

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating CoderRupee mutations do
 * not overwrite changes made from the same stale content.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.canonical)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: Target, existed: boolean): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.exists(input.target.canonical)
          yield* fs.writeWithDirs(input.target.canonical, input.content)
          return writeResult(input.target, existed)
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = splitBom(input.content)
          const current = yield* fs
            .readFile(input.target.canonical)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
          yield* fs.writeWithDirs(
            input.target.canonical,
            joinBom(next.text, Boolean(current && hasUtf8Bom(current)) || next.bom),
          )
          return writeResult(input.target, current !== undefined)
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const write =
            typeof input.content === "string"
              ? fs.writeFileString(input.target.canonical, input.content, { flag: "wx" })
              : fs.writeFile(input.target.canonical, input.content, { flag: "wx" })
          yield* write.pipe(
            Effect.catchReason("PlatformError", "NotFound", () =>
              fs.ensureDir(dirname(input.target.canonical)).pipe(Effect.andThen(write)),
            ),
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              Effect.fail(new TargetExistsError({ path: input.target.canonical })),
            ),
          )
          return writeResult(input.target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* fs.readFile(input.target.canonical)
          // Crash replay: when the target already holds the intended bytes the
          // mutation settled before the crash, so succeed without rewriting.
          const applied =
            typeof input.content === "string"
              ? new TextDecoder().decode(current) === input.content
              : sameBytes(current, input.content)
          if (applied) return writeResult(input.target, true)
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.canonical })
          }
          yield* typeof input.content === "string"
            ? fs.writeFileString(input.target.canonical, input.content)
            : fs.writeFile(input.target.canonical, input.content)
          return writeResult(input.target, true)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.remove(input.target.canonical).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
          )
          return removeResult(input.target, existed)
        }),
      ),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove })
  }),
)

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

/**
 * Deferred until the corresponding V2 integrations exist.
 */
// TODO: Capture single-mutation snapshots / undo after the V2 session undo design exists.
// TODO: Define durable crash recovery for side effects between Tool.Called and durable settlement; writeIfUnchanged already replays already-applied mutations deterministically.
// TODO: Provide the coderrupee adapter layers mapping Format.Service and LSP.Service onto the Formatter and Diagnostics seams above (production formatting and LSP diagnostics stay inert until then).
