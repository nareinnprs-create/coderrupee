import { describe, expect, test } from "bun:test"
import { chmod, stat, writeFile } from "node:fs/promises"
import { Effect, Layer } from "effect"
import path from "path"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqliteBun } from "@coderrupee/core/database/sqlite.bun"
import { SqliteNode } from "@coderrupee/core/database/sqlite.node"
import { tmpdir } from "./fixture/tmpdir"

// Stat while the connection is open: SQLite may remove the sidecars on close.
// A write primes WAL so the -wal/-shm sidecars exist even on fresh databases.
const modesWhileOpen = (make: (filename: string) => Layer.Layer<SqlClient>, filename: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* SqlClient
        const connection = yield* client.reserve
        yield* connection.execute("CREATE TABLE IF NOT EXISTS warm (id INTEGER)", [], undefined)
        yield* connection.execute("INSERT INTO warm (id) VALUES (1)", [], undefined)
        return yield* Effect.promise(() =>
          Promise.all(
            ["", "-wal", "-shm"].map(async (suffix) => (await stat(filename + suffix)).mode & 0o777),
          ),
        )
      }).pipe(Effect.provide(make(filename))),
    ),
  )

// Older Bun releases ship no node:sqlite builtin; the specifier is computed so
// Bun's transpiler cannot resolve the builtin at module-graph collection time.
let nodeSqliteAvailable = false
try {
  await import("node" + ":sqlite")
  nodeSqliteAvailable = true
} catch {
  nodeSqliteAvailable = false
}

describe.skipIf(process.platform === "win32")("database file permissions", () => {
  const clients: Array<readonly [string, (filename: string) => Layer.Layer<SqlClient>]> = [
    ["bun", (filename) => SqliteBun.layer({ filename })],
  ]
  if (nodeSqliteAvailable) clients.push(["node", (filename) => SqliteNode.layer({ filename })])

  for (const [name, make] of clients) {
    test(`${name} client creates the database and sidecars readable only by the owner`, async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "coderrupee.db")
      const modes = await modesWhileOpen(make, filename)
      expect(modes).toEqual([0o600, 0o600, 0o600])
    })

    test(`${name} client tightens an existing database and sidecars`, async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "coderrupee.db")
      await Promise.all(
        ["", "-wal", "-shm"].map(async (suffix) => {
          await writeFile(filename + suffix, "")
          await chmod(filename + suffix, 0o644)
        }),
      )
      const modes = await modesWhileOpen(make, filename)
      expect(modes).toEqual([0o600, 0o600, 0o600])
    })
  }
})
