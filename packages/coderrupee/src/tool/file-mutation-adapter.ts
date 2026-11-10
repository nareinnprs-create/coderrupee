import { FileMutation } from "@coderrupee/core/file-mutation"
import { FSUtil } from "@coderrupee/core/fs-util"
import { Effect } from "effect"
import { Format } from "@/format/index"
import * as LSPClient from "@/lsp/client"
import { Diagnostic } from "@/lsp/diagnostic"
import { LSP } from "@/lsp/lsp"

// Registers the app Format and LSP services with the core FileMutation pipeline so
// edit/write/apply-patch settle runs formatting and surfaces LSP errors. Called once
// from bootstrap init, where both services are already resolved.
export const registerFileMutationAdapter = Effect.fn("FileMutationAdapter.register")(function* (
  format: Format.Interface,
  lsp: LSP.Interface,
) {
  FileMutation.registerFileMutationAdapter({
    formatter: {
      file: (filepath) => format.file(filepath),
    },
    diagnostics: {
      afterEdit: (file) =>
        Effect.gen(function* () {
          yield* lsp.touchFile(file, "document").pipe(Effect.catch(() => Effect.void))
          const all = yield* lsp.diagnostics().pipe(
            Effect.catch(() => Effect.succeed({} as Record<string, LSPClient.Diagnostic[]>)),
          )
          return Diagnostic.report(file, all[FSUtil.normalizePath(file)] ?? [])
        }),
    },
  })
})

export * as FileMutationAdapter from "./file-mutation-adapter"
