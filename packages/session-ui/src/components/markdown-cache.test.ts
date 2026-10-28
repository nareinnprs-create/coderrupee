import { expect, mock, test } from "bun:test"

// markdown-cache pulls the worker module, which carries a Vite-only
// `?worker&url` import; stub the one function the cache uses from it.
mock.module("./markdown-worker", () => ({ parseMarkdown: async (text: string) => `<p>${text}</p>` }))

const { lookupMarkdownBlock, MARKDOWN_CACHE_MAX, touchCachedMarkdown } = await import("./markdown-cache")

type MarkdownCacheEntry = import("./markdown-cache").MarkdownCacheEntry

const entry = (raw: string): MarkdownCacheEntry => ({ raw, hash: String(raw.length), html: `<p>${raw}</p>` })

test("cache evicts oldest beyond the configured cap", () => {
  // The module cache is process-global; run against fresh keys.
  const prefix = `cap-test-${Date.now()}-`
  const total = MARKDOWN_CACHE_MAX + 25
  for (let index = 0; index < total; index++) touchCachedMarkdown(`${prefix}${index}`, entry(`raw-${index}`))

  // Every key just written is subject to the cap: the newest survive, the
  // oldest of this batch are gone.
  expect(lookupMarkdownBlock(`${prefix}${total - 1}`, `raw-${total - 1}`)).toBeDefined()
  expect(
    lookupMarkdownBlock(`${prefix}${total - MARKDOWN_CACHE_MAX}`, `raw-${total - MARKDOWN_CACHE_MAX}`),
  ).toBeDefined()
  expect(lookupMarkdownBlock(`${prefix}0`, "raw-0")).toBeUndefined()
})

test("touching refreshes recency so touched keys survive eviction", () => {
  const prefix = `lru-test-${Date.now()}-`
  for (let index = 0; index < MARKDOWN_CACHE_MAX; index++)
    touchCachedMarkdown(`${prefix}${index}`, entry(`raw-${index}`))

  // Refresh the oldest quarter, then push the cache past its cap by more than
  // the untouched remainder so untouched keys evict first.
  for (let index = 0; index < MARKDOWN_CACHE_MAX / 4; index++) {
    const key = `${prefix}${index}`
    const cached = lookupMarkdownBlock(key, `raw-${index}`)
    expect(cached).toBeDefined()
    touchCachedMarkdown(key, cached!)
  }
  const fresh = MARKDOWN_CACHE_MAX / 2 + 10
  for (let index = 0; index < fresh; index++) touchCachedMarkdown(`${prefix}new-${index}`, entry(`new-${index}`))

  // Refreshed keys were treated as most-recent and survived.
  expect(lookupMarkdownBlock(`${prefix}0`, "raw-0")).toBeDefined()
  expect(
    lookupMarkdownBlock(`${prefix}${MARKDOWN_CACHE_MAX / 4 - 1}`, `raw-${MARKDOWN_CACHE_MAX / 4 - 1}`),
  ).toBeDefined()
  // Untouched oldest keys were evicted first.
  expect(lookupMarkdownBlock(`${prefix}${MARKDOWN_CACHE_MAX / 2}`, `raw-${MARKDOWN_CACHE_MAX / 2}`)).toBeUndefined()
})

test("lookup misses on raw mismatch even when the key exists", () => {
  const key = `mismatch-test-${Date.now()}`
  touchCachedMarkdown(key, entry("original"))
  expect(lookupMarkdownBlock(key, "original")).toBeDefined()
  expect(lookupMarkdownBlock(key, "changed")).toBeUndefined()
})
