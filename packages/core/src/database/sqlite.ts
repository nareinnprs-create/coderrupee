export * as Sqlite from "./sqlite"

import { chmodSync, closeSync, existsSync, openSync } from "node:fs"
import { Context } from "effect"
import type { drizzle } from "drizzle-orm/bun-sqlite"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@coderrupee/core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()("@coderrupee/core/database/SqliteDrizzle") {}

// SQLite creates new sidecars with the database's mode, but does not tighten existing sidecars.
// Windows relies on the user profile directory's inherited ACLs instead of POSIX modes.
export function restrictToOwner(filename: string, create: boolean) {
  if (process.platform === "win32" || filename === ":memory:") return
  // Opening and closing an existing database can release another connection's POSIX locks.
  // Create missing files synchronously so another fiber cannot open one before it is restricted.
  if (create && !existsSync(filename)) closeSync(openSync(filename, "a", 0o600))
  chmodSync(filename, 0o600)
  for (const suffix of ["-wal", "-shm"]) {
    try {
      chmodSync(filename + suffix, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}
