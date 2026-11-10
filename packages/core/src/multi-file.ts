export * as MultiFile from "./multi-file"

import { Effect } from "effect"
import { FileMutation } from "./file-mutation"
import { FSUtil } from "./fs-util"

export type Change =
  | {
      readonly path: string
      readonly target: FileMutation.Target
      readonly operation: "create"
      readonly content: string | Uint8Array
    }
  | {
      readonly path: string
      readonly target: FileMutation.Target
      readonly operation: "update"
      readonly expected: Uint8Array
      readonly content: string | Uint8Array
    }
  | {
      readonly path: string
      readonly target: FileMutation.Target
      readonly operation: "delete"
      readonly original: Uint8Array
    }

export type Result = FileMutation.WriteResult | FileMutation.RemoveResult

export interface Failure {
  readonly path: string
  readonly cause: FileMutation.TargetExistsError | FileMutation.StaleContentError | FSUtil.Error
  /** Resources applied before the failure; they were rolled back when possible. */
  readonly applied: readonly string[]
}

interface Undo {
  readonly path: string
  readonly undo: Effect.Effect<void, FSUtil.Error>
}

/**
 * Apply prepared changes in order, all-or-nothing on typed failures: when a
 * change fails, earlier changes are rolled back in reverse from the original
 * bytes each change already carries. Defects and interruption still propagate
 * without rollback.
 */
export const apply = (files: FileMutation.Interface, changes: ReadonlyArray<Change>) =>
  Effect.gen(function* () {
    const undos: Undo[] = []
    const applied: string[] = []
    const results: Result[] = []
    for (const change of changes) {
      const failed = (cause: Failure["cause"]) => ({ path: change.path, cause, applied: [...applied] })
      const result = yield* Effect.gen(function* () {
        if (change.operation === "create")
          return yield* files.create({ target: change.target, content: change.content }).pipe(Effect.mapError(failed))
        if (change.operation === "delete")
          return yield* files.remove({ target: change.target }).pipe(Effect.mapError(failed))
        return yield* files
          .writeIfUnchanged({ target: change.target, expected: change.expected, content: change.content })
          .pipe(Effect.mapError(failed))
      }).pipe(
        Effect.catch((failure) => rollback(undos).pipe(Effect.andThen(() => Effect.fail(failure)))),
      )
      applied.push(result.resource)
      results.push(result)
      if (change.operation === "create")
        undos.push({ path: change.path, undo: files.remove({ target: change.target }).pipe(Effect.asVoid) })
      if (change.operation === "update")
        undos.push({
          path: change.path,
          undo: files.write({ target: change.target, content: change.expected }).pipe(Effect.asVoid),
        })
      if (change.operation === "delete")
        undos.push({
          path: change.path,
          undo: files.write({ target: change.target, content: change.original }).pipe(Effect.asVoid),
        })
    }
    return results
  })

const rollback = (undos: Undo[]) =>
  Effect.gen(function* () {
    for (const item of undos.toReversed())
      yield* item.undo.pipe(
        Effect.catch((error) => Effect.logWarning("failed to roll back file mutation", { path: item.path, error })),
      )
  })
