import { expect, test } from "bun:test"
import { openDesktopDraftStore } from "./draft-store"

test(
  "flushes the latest buffered draft and stores blobs",
  async () => {
    // Older Bun releases ship no node:sqlite builtin; skip rather than fail there.
    let available = false
    try {
      await import("node" + ":sqlite")
      available = true
    } catch {
      available = false
    }
    if (!available) return
    const store = await openDesktopDraftStore(":memory:")
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
