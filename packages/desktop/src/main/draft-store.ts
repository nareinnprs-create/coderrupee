import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core"

// bun-types declares node:sqlite's DatabaseSync without a construct signature.
interface DatabaseSyncCtor {
  new (filename: string): DatabaseSyncInstance
}
interface DatabaseSyncInstance {
  exec: (sql: string) => void
  close: () => void
}
type NodeSqliteDatabase = import("node:sqlite").DatabaseSync

const documents = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})
const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
})

// Older Bun releases ship no node:sqlite builtin, and drizzle's node-sqlite driver
// statically imports it, so both imports stay dynamic and computed: a literal
// specifier would fail this module's graph before any runtime guard can run.
export async function openDesktopDraftStore(filename: string) {
  const [{ DatabaseSync: DatabaseSyncCtor }, { drizzle }] = await Promise.all([
    import(/* @vite-ignore */ "node" + ":sqlite") as Promise<{ DatabaseSync: DatabaseSyncCtor }>,
    import("drizzle-orm/node-sqlite"),
  ])
  const native = new DatabaseSyncCtor(filename) as NodeSqliteDatabase
  native.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blob (id TEXT PRIMARY KEY, data BLOB NOT NULL);",
  )
  const db = drizzle({ client: native })
  const used = new Set<string>()
  db.select({ value: documents.value })
    .from(documents)
    .all()
    .forEach(({ value }) =>
      JSON.parse(value, (_key, item) => {
        if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
        return item
      }),
    )
  db.select({ id: blobs.id })
    .from(blobs)
    .all()
    .filter(({ id }) => !used.has(id))
    .forEach(({ id }) => db.delete(blobs).where(eq(blobs.id, id)).run())
  const pending = new Map<string, string | null>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const writes = [...pending]
    pending.clear()
    db.transaction((tx) => {
      writes.forEach(([key, value]) => {
        if (value === null) tx.delete(documents).where(eq(documents.key, key)).run()
        else
          tx.insert(documents)
            .values({ key, value })
            .onConflictDoUpdate({ target: documents.key, set: { value } })
            .run()
      })
    })
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 500)
  }
  return {
    get: (key: string) =>
      pending.has(key)
        ? (pending.get(key) ?? null)
        : (db.select({ value: documents.value }).from(documents).where(eq(documents.key, key)).get()?.value ?? null),
    set(key: string, value: string | null) {
      pending.set(key, value)
      schedule()
    },
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      db.insert(blobs)
        .values({ id, data: Buffer.from(data) })
        .onConflictDoNothing()
        .run()
      return id
    },
    getBlob: (id: string) => db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null,
    flush,
    close() {
      flush()
      native.close()
    },
  }
}
