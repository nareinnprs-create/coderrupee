/**
 * Model-facing V2 exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit"

import { ToolFailure } from "@coderrupee/llm"
import { FileDiff } from "@coderrupee/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { EditReplace } from "./edit-replace"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "edit"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to edit. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to replace" }),
  newString: Schema.String.annotate({ description: "Replacement text, which must differ from oldString" }),
  replaceAll: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace all exact occurrences of oldString (default false)",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(FileDiff.Info),
  replacements: Schema.Number,
  diagnostics: Schema.optional(Schema.String),
})
export type Output = typeof Output.Type

const previewLines = (value: string, prefix: "+" | "-") => {
  const lines = value.replaceAll("\r\n", "\n").split("\n")
  const shown = lines.slice(0, 6).map((line) => `${prefix}${line.length > 240 ? `${line.slice(0, 240)}...` : line}`)
  if (lines.length > shown.length) shown.push(`${prefix}...`)
  return shown
}

export const toModelOutput = (output: Output, oldString: string, newString: string) => {
  const lines = [
    `Edited file successfully: ${output.files[0]?.file}`,
    `Replacements: ${output.replacements}`,
    "```diff",
    ...previewLines(oldString, "-"),
    ...previewLines(newString, "+"),
    "```",
  ]
  if (output.diagnostics) lines.push("", `LSP errors detected in this file, please fix:\n${output.diagnostics}`)
  return lines.join("\n")
}

/**
 * Matching, replacement, and post-mutation settle (format, file events, LSP
 * diagnostics) come from the EditReplace module and the FileMutation pipeline.
 * Single-mutation snapshots / undo remain deferred.
 */
// TODO: Capture single-edit snapshots / undo after the V2 session undo design exists.

const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const joinBom = (text: string, bom: boolean) => (bom ? `\uFEFF${text}` : text)
const decodeUtf8 = (content: Uint8Array) => {
  const bom = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
  return { bom, content, text: new TextDecoder().decode(bom ? content.slice(3) : content) }
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Replace exact text in one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
            input: Input,
            output: Output,
            toModelOutput: ({ input, output }) => [
              { type: "text", text: toModelOutput(output, input.oldString, input.newString) },
            ],
            execute: (input, context) => {
              const unableToEdit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                effect.pipe(
                  Effect.mapError((error) =>
                    error instanceof FileMutation.StaleContentError
                      ? new ToolFailure({
                          message: "File changed after permission approval. Read it again before editing.",
                        })
                      : new ToolFailure({ message: `Unable to edit ${input.path}` }),
                  ),
                )

              return Effect.gen(function* () {
                const permissionSource = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                if (input.oldString === input.newString) {
                  return yield* new ToolFailure({
                    message: "No changes to apply: oldString and newString are identical.",
                  })
                }
                if (input.oldString === "") {
                  return yield* new ToolFailure({
                    message: "oldString must not be empty. Use write to create or overwrite a file.",
                  })
                }

                const target = yield* unableToEdit(mutation.resolve({ path: input.path, kind: "file" }))
                const external = target.externalDirectory
                if (external) {
                  yield* unableToEdit(
                    permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: permissionSource,
                    }),
                  )
                }

                yield* unableToEdit(
                  permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: permissionSource,
                  }),
                )
                const source = decodeUtf8(yield* unableToEdit(fs.readFile(target.canonical)))
                // Strings that differ only in \r ask to change line endings themselves, so they apply to the exact
                // bytes. Every other edit matches the LF view Read shows the model and keeps the file's endings.
                const endingsOnly = input.oldString.replaceAll("\r", "") === input.newString.replaceAll("\r", "")
                const matched = endingsOnly
                  ? { matches: EditReplace.findOccurrences(source.text, input.oldString), replace: () => input.newString }
                  : EditReplace.matchView(source.text, input.oldString, input.newString)
                const replacements = matched.matches.length
                if (replacements === 0) {
                  const hint = EditReplace.missHint(source.text, input.oldString, input.newString)
                  return yield* new ToolFailure({
                    message:
                      "Could not find oldString in the file. It must match exactly, including whitespace and indentation." +
                      (hint ? `\n\n${hint}` : ""),
                  })
                }
                if (replacements > 1 && input.replaceAll !== true) {
                  return yield* new ToolFailure({
                    message:
                      "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
                  })
                }

                const replaced = (input.replaceAll === true ? matched.matches : matched.matches.slice(0, 1))
                  .toReversed()
                  .reduce(
                    (content, match) => `${content.slice(0, match.start)}${matched.replace(match)}${content.slice(match.end)}`,
                    source.text,
                  )
                if (replaced === source.text) {
                  return yield* new ToolFailure({
                    message: "No changes to apply: the edit leaves the file unchanged.",
                  })
                }
                const counts = (text: string) =>
                  diffLines(source.text, text).reduce(
                    (result, item) => ({
                      additions: result.additions + (item.added ? (item.count ?? 0) : 0),
                      deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
                    }),
                    { additions: 0, deletions: 0 },
                  )
                const next = splitBom(replaced)
                const result = yield* unableToEdit(
                  files.writeIfUnchanged({
                    target,
                    expected: source.content,
                    content: joinBom(next.text, source.bom || next.bom),
                  }),
                )
                const settled = yield* FileMutation.settle(result)
                const edited =
                  settled.formatted ? decodeUtf8(yield* unableToEdit(fs.readFile(target.canonical))).text : replaced
                return {
                  files: [
                    {
                      file: result.resource,
                      patch: createTwoFilesPatch(result.resource, result.resource, source.text, edited),
                      status: "modified" as const,
                      ...counts(edited),
                    },
                  ],
                  replacements,
                  ...(settled.diagnostics ? { diagnostics: settled.diagnostics } : {}),
                } satisfies Output
              })
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/edit",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FileMutation.node, FSUtil.node, PermissionV2.node],
})
