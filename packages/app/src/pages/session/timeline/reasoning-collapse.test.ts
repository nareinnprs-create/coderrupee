import { describe, expect, test } from "bun:test"
import { reasoningContent, reasoningExpanded } from "./reasoning-collapse"

describe("reasoning collapse", () => {
  test("strips redacted placeholders and trims reasoning content", () => {
    expect(reasoningContent("  Working through the steps.\n")).toBe("Working through the steps.")
    expect(reasoningContent("[REDACTED]")).toBe("")
    expect(reasoningContent(undefined)).toBe("")
  })

  test("defaults expanded while streaming and collapsed after completion", () => {
    expect(reasoningExpanded(undefined, true)).toBe(true)
    expect(reasoningExpanded(undefined, false)).toBe(false)
  })

  test("user toggle overrides the streaming default", () => {
    expect(reasoningExpanded(false, true)).toBe(false)
    expect(reasoningExpanded(true, false)).toBe(true)
  })
})
