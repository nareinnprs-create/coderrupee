import { expect, test } from "bun:test"
import { createDesktopDraftStore } from "./draft-store"

test(
  "flushes the latest buffered draft and stores blobs",
  async () => {
    // Older Bun releases ship no node:sqlite builtin; skip instead of failing there.
    // Computed specifier so the transpiler cannot resolve it at graph-collection time.
    let available = false
    try {
      await import("node" + ":sqlite")
      available = true
    } catch {
      available = false
    }
    if (!available) return
    const { DatabaseSync } = await import("node" + ":sqlite")
    const store = createDesktopDraftStore(new DatabaseSync(":memory:"))
    store.set("prompt", "first")
    store.set("prompt", "latest")
    expect(store.get("prompt")).toBe("latest")
    store.flush()
    expect(store.get("prompt")).toBe("latest")

    const bytes = new TextEncoder().encode("image")
    const id = store.putBlob(bytes)
    expect(store.getBlob(id)).toEqual(bytes)
    store.close()
  },
  60_000,
)
