import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqliteBun } from "@coderrupee/core/database/sqlite.bun"
import { SqliteNode } from "@coderrupee/core/database/sqlite.node"

const streamRows = Effect.gen(function* () {
  const client = yield* SqlClient
  const connection = yield* client.reserve
  yield* connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", [], undefined)
  yield* connection.execute("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')", [], undefined)
  const rows = yield* Stream.runCollect(connection.executeStream("SELECT id, name FROM t ORDER BY id", [], undefined))
  return Array.from(rows) as Array<Record<string, unknown>>
})

const expected = [
  { id: 1, name: "a" },
  { id: 2, name: "b" },
  { id: 3, name: "c" },
]

const run = (layer: Layer.Layer<SqlClient>) => Effect.runPromise(Effect.scoped(Effect.provide(streamRows, layer)))

describe("executeStream", () => {
  test("streams rows from the bun sqlite client", async () => {
    const rows = await run(SqliteBun.layer({ filename: ":memory:", disableWAL: true }))
    expect(rows).toEqual(expected)
  })

  test("streams rows from the node sqlite client", async () => {
    const rows = await run(SqliteNode.layer({ filename: ":memory:", disableWAL: true }))
    expect(rows).toEqual(expected)
  })
})
