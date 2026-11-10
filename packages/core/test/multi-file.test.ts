import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@coderrupee/core/effect/app-node-builder"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { FileMutation } from "@coderrupee/core/file-mutation"
import { MultiFile } from "@coderrupee/core/multi-file"
import { Location } from "@coderrupee/core/location"
import { LocationMutation } from "@coderrupee/core/location-mutation"
import { AbsolutePath } from "@coderrupee/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function provide(directory: string) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([LocationMutation.node, FileMutation.node]), [
      [Location.node, activeLocation],
    ]),
  )
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("MultiFile", () => {
  it.live("applies create, update, and delete in order and returns aligned results", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const files = yield* FileMutation.Service
        yield* Effect.promise(() => Promise.all([
          fs.writeFile(path.join(directory, "update.txt"), "before\n"),
          fs.writeFile(path.join(directory, "delete.txt"), "gone\n"),
        ]))
        const updateTarget = yield* (yield* LocationMutation.Service).resolve({ path: "update.txt" })
        const deleteTarget = yield* (yield* LocationMutation.Service).resolve({ path: "delete.txt" })
        const createTarget = yield* (yield* LocationMutation.Service).resolve({ path: "new.txt" })

        const results = yield* MultiFile.apply(files, [
          {
            path: "new.txt",
            target: createTarget,
            operation: "create",
            content: "created\n",
          },
          {
            path: "update.txt",
            target: updateTarget,
            operation: "update",
            expected: new TextEncoder().encode("before\n"),
            content: "after\n",
          },
          {
            path: "delete.txt",
            target: deleteTarget,
            operation: "delete",
            original: new TextEncoder().encode("gone\n"),
          },
        ])

        expect(results.map((result) => result.resource)).toEqual(["new.txt", "update.txt", "delete.txt"])
        expect(results.map((result) => result.operation)).toEqual(["write", "write", "remove"])
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "new.txt"), "utf8"))).toBe("created\n")
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "update.txt"), "utf8"))).toBe("after\n")
        expect(
          yield* Effect.promise(() => fs.access(path.join(directory, "delete.txt")).then(() => true).catch(() => false)),
        ).toBe(false)
      }).pipe(provide(directory)),
    ),
  )

  it.live("rolls back earlier updates with their original bytes when a later update goes stale", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const files = yield* FileMutation.Service
        const first = path.join(directory, "first.txt")
        const second = path.join(directory, "second.txt")
        yield* Effect.promise(() =>
          Promise.all([fs.writeFile(first, "original first\n"), fs.writeFile(second, "moved on\n")]),
        )
        const firstTarget = yield* (yield* LocationMutation.Service).resolve({ path: "first.txt" })
        const secondTarget = yield* (yield* LocationMutation.Service).resolve({ path: "second.txt" })

        const failure = yield* MultiFile.apply(files, [
          {
            path: "first.txt",
            target: firstTarget,
            operation: "update",
            expected: new TextEncoder().encode("original first\n"),
            content: "changed first\n",
          },
          {
            path: "second.txt",
            target: secondTarget,
            operation: "update",
            expected: new TextEncoder().encode("stale expectation\n"),
            content: "changed second\n",
          },
        ]).pipe(Effect.flip)

        expect(failure.path).toBe("second.txt")
        expect(failure.applied).toEqual(["first.txt"])
        expect(yield* Effect.promise(() => fs.readFile(first, "utf8"))).toBe("original first\n")
        expect(yield* Effect.promise(() => fs.readFile(second, "utf8"))).toBe("moved on\n")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rolls back creates and deletes when a later operation fails", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const files = yield* FileMutation.Service
        const created = path.join(directory, "created.txt")
        const removed = path.join(directory, "removed.txt")
        const stale = path.join(directory, "stale.txt")
        yield* Effect.promise(() =>
          Promise.all([fs.writeFile(removed, "removed content\n"), fs.writeFile(stale, "moved on\n")]),
        )
        const createdTarget = yield* (yield* LocationMutation.Service).resolve({ path: "created.txt" })
        const removedTarget = yield* (yield* LocationMutation.Service).resolve({ path: "removed.txt" })
        const staleTarget = yield* (yield* LocationMutation.Service).resolve({ path: "stale.txt" })

        const failure = yield* MultiFile.apply(files, [
          { path: "created.txt", target: createdTarget, operation: "create", content: "temporary\n" },
          {
            path: "removed.txt",
            target: removedTarget,
            operation: "delete",
            original: new TextEncoder().encode("removed content\n"),
          },
          {
            path: "stale.txt",
            target: staleTarget,
            operation: "update",
            expected: new TextEncoder().encode("stale expectation\n"),
            content: "changed\n",
          },
        ]).pipe(Effect.flip)

        expect(failure.path).toBe("stale.txt")
        expect(yield* Effect.promise(() => fs.access(created).then(() => true).catch(() => false))).toBe(false)
        expect(yield* Effect.promise(() => fs.readFile(removed, "utf8"))).toBe("removed content\n")
        expect(yield* Effect.promise(() => fs.readFile(stale, "utf8"))).toBe("moved on\n")
      }).pipe(provide(directory)),
    ),
  )
})
