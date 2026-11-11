import { describe, expect, test } from "bun:test"
import { chmod, stat, writeFile } from "node:fs/promises"
import { Effect, Layer } from "effect"
import path from "path"
import { SqliteBun } from "@coderrupee/core/database/sqlite.bun"
import { SqliteNode } from "@coderrupee/core/database/sqlite.node"
import { tmpdir } from "./fixture/tmpdir"

// Read while the connection is open: SQLite may remove the sidecars on close.
const modesWhileOpen = (make: (filename: string) => Layer.Layer<never>, filename: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(make(filename))
        return yield* Effect.promise(() =>
          Promise.all(
            ["", "-wal", "-shm"].map(async (suffix) => (await stat(filename + suffix)).mode & 0o777),
          ),
        )
      }),
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
  const clients: Array<readonly [string, (filename: string) => Layer.Layer<never>]> = [
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
