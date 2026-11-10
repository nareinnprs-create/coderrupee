import { LayerNode } from "@coderrupee/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { parse } from "jsonc-parser"
import { NonNegativeInt } from "@coderrupee/core/schema"
import { Global } from "@coderrupee/core/global"
import { FSUtil } from "@coderrupee/core/fs-util"
import { isRecord } from "@/util/record"
import { Keyring } from "./keyring"

import { OAUTH_DUMMY_KEY } from "./dummy-key"

export { OAUTH_DUMMY_KEY }

const file = path.join(Global.Path.data, "auth.json")
// Recovery copy kept after a successful keyring migration (never deleted, so
// a broken OS keyring can never leave the user without credentials).
const migratedFile = path.join(Global.Path.data, "auth.json.migrated")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@coderrupee/Auth") {}

type StorageMode = "auto" | "keyring" | "plaintext"
type Storage = { readonly kind: "keyring" } | { readonly kind: "plaintext" }

// Config file candidates mirror the global config lookup: the first file that
// exists wins, so `auth.storage` is only read from the winning global file.
// This deliberately bypasses the Config service (which depends on Auth) and
// managed/remote config; enterprise opt-out can ship with those later.
const globalConfigCandidates = ["coderrupee.jsonc", "coderrupee.json", "config.json"].map((name) =>
  path.join(Global.Path.config, name),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const keyring = yield* Keyring.Service
    const decode = Schema.decodeUnknownOption(Info)

    const readRawEntries = Effect.fn("Auth.readRawEntries")(function* (target: string) {
      const data = yield* fsys.readJson(target).pipe(Effect.orElseSucceed(() => undefined))
      return isRecord(data) ? data : undefined
    })

    const decodeEntries = Effect.fn("Auth.decodeEntries")(function* (data: Record<string, unknown>, source: string) {
      const entries = Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      const corrupt = Object.keys(data).length - Object.keys(entries).length
      if (corrupt > 0) yield* Effect.logWarning(`ignoring ${corrupt} unreadable credential entries in ${source}`)
      return entries
    })

    const readPlaintext = (target: string) =>
      Effect.gen(function* () {
        const data = yield* readRawEntries(target)
        if (data === undefined) return {}
        return yield* decodeEntries(data, path.basename(target))
      })

    const storageMode = Effect.fn("Auth.storageMode")(function* () {
      for (const candidate of globalConfigCandidates) {
        const text = yield* fsys.readFileStringSafe(candidate).pipe(Effect.orElseSucceed(() => undefined))
        if (text === undefined) continue
        const parsed: unknown = parse(text)
        const storage = isRecord(parsed) && isRecord(parsed.auth) ? parsed.auth.storage : undefined
        if (storage === "auto" || storage === "keyring" || storage === "plaintext") return storage
        return "auto"
      }
      return "auto"
    })

    // Repeat migration attempts (a restored auth.json in keyring mode) must
    // not spam the log; migration notices are emitted once per process.
    let noticed = false
    const noticeOnce = (message: string, fields?: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (noticed) return
        noticed = true
        yield* Effect.logWarning(message, fields)
      })

    // Copies every decodable auth.json entry into the keyring, then renames the
    // file to the recovery copy. Returns false when the file must stay
    // authoritative (undecodable entries or keyring write failure).
    const absorbPlaintext = Effect.fn("Auth.absorbPlaintext")(function* (raw: Record<string, unknown>) {
      const entries = yield* decodeEntries(raw, "auth.json")
      if (Object.keys(entries).length !== Object.keys(raw).length) {
        // Entries we cannot interpret must stay untouched on disk.
        yield* noticeOnce(
          "auth.json has entries that could not be decoded; skipping keyring migration and keeping plaintext storage",
        )
        return false
      }

      const migrated = yield* Effect.forEach(
        Object.entries(entries),
        ([account, info]) => keyring.set(account, JSON.stringify(info)),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          noticeOnce("failed to migrate auth.json into the OS keyring; keeping plaintext storage", { cause }).pipe(
            Effect.as(false),
          ),
        ),
      )
      if (!migrated) return false

      // Rename instead of delete: the file remains as a recovery copy.
      yield* fsys.rename(file, migratedFile).pipe(
        Effect.catch((cause) => noticeOnce("could not rename auth.json to auth.json.migrated after migration", { cause })),
        Effect.orElseSucceed(() => undefined),
      )
      return true
    })

    // Decides where credentials live for this process and, on first use,
    // migrates plaintext credentials into the OS keyring. Cached so concurrent
    // callers share one migration and later calls reuse the decision.
    const resolveStorage = Effect.fn("Auth.resolveStorage")(function* () {
      const mode = yield* storageMode()
      if (mode === "plaintext") return { kind: "plaintext" } as Storage

      const available = yield* keyring.isAvailable()
      if (!available) {
        if (mode === "keyring") {
          yield* Effect.logWarning(
            "auth.storage is set to 'keyring' but no OS keyring is available; keeping credentials in plaintext auth.json",
          )
        }
        return { kind: "plaintext" } as Storage
      }

      const raw = yield* readRawEntries(file)
      if (raw === undefined) return { kind: "keyring" } as Storage

      const migrated = yield* absorbPlaintext(raw)
      return (migrated ? { kind: "keyring" } : { kind: "plaintext" }) as Storage
    })

    const storageOnce = yield* Effect.cached(resolveStorage())

    // Corrupt keyring entries are skipped on every read; warn once per account.
    const warnedCorrupt = new Set<string>()

    const readKeyring = Effect.fn("Auth.readKeyring")(function* () {
      const stored = yield* keyring.list().pipe(
        Effect.catch((cause) =>
          Effect.logWarning("OS keyring is unreadable; falling back to the migrated plaintext copy", { cause }).pipe(
            Effect.as(undefined),
          ),
        ),
      )
      if (stored === undefined) return yield* readPlaintext(migratedFile)
      const parsed: Record<string, unknown> = {}
      let corrupt = 0
      for (const [account, value] of Object.entries(stored)) {
        try {
          parsed[account] = JSON.parse(value)
        } catch {
          if (!warnedCorrupt.has(account)) {
            warnedCorrupt.add(account)
            yield* Effect.logWarning("ignoring corrupt keyring entry", { account })
          }
          corrupt += 1
        }
      }
      if (corrupt > 0) yield* Effect.logWarning(`skipped ${corrupt} corrupt keyring entries`)
      return yield* decodeEntries(parsed, "keyring")
    })

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.CODERRUPEE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.CODERRUPEE_AUTH_CONTENT)
        } catch (err) {}
      }

      const storage = yield* storageOnce
      if (storage.kind === "plaintext") return yield* readPlaintext(file)

      // A plaintext file (re)appearing in keyring mode - restored backup,
      // failed rename - is re-absorbed so its credentials stay reachable.
      const raw = yield* readRawEntries(file)
      if (raw !== undefined) {
        const absorbed = yield* absorbPlaintext(raw)
        if (!absorbed) return yield* readPlaintext(file)
      }
      return yield* readKeyring()
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const storage = yield* storageOnce
      if (storage.kind === "keyring") {
        if (norm !== key) {
          yield* keyring.delete(key).pipe(Effect.mapError(fail("Failed to write auth data")))
        }
        yield* keyring.delete(norm + "/").pipe(Effect.mapError(fail("Failed to write auth data")))
        yield* keyring.set(norm, JSON.stringify(info)).pipe(Effect.mapError(fail("Failed to write auth data")))
        return
      }
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const storage = yield* storageOnce
      if (storage.kind === "keyring") {
        if (norm !== key) {
          yield* keyring.delete(key).pipe(Effect.mapError(fail("Failed to write auth data")))
        }
        yield* keyring.delete(norm).pipe(Effect.mapError(fail("Failed to write auth data")))
        return
      }
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Keyring.node] })

export * as Auth from "."
