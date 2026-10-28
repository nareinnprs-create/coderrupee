import { describe, expect, test } from "bun:test"
import { estimateRowSize, normalizeThinkingMeasurements } from "./virtual-items"

describe("estimateRowSize", () => {
  test("maps each row tag to its typical rendered height", () => {
    expect(estimateRowSize({ _tag: "TurnGap" })).toBe(24)
    expect(estimateRowSize({ _tag: "Thinking" })).toBe(28)
    expect(estimateRowSize({ _tag: "AssistantPart" })).toBe(240)
    expect(estimateRowSize({ _tag: "UserMessage" })).toBe(88)
  })

  test("returns undefined for unknown tags so callers keep the fallback", () => {
    expect(estimateRowSize({ _tag: "Unknown" })).toBeUndefined()
  })
})

describe("normalizeThinkingMeasurements", () => {
  test("collapses stale expanded thinking rows and rebuilds prefix offsets", () => {
    const snapshot = [
      { index: 0, key: "user-message:m1", start: 0, size: 88 },
      // Streamed reasoning captured at its expanded height.
      { index: 1, key: "thinking:m1:prt_1", start: 88, size: 320 },
      { index: 2, key: "assistant-part:m1:g1", start: 408, size: 240 },
      { index: 3, key: "thinking:m1:prt_2", start: 648, size: 512 },
    ]
    const restored = normalizeThinkingMeasurements(snapshot)
    expect(restored.map((item) => item.size)).toEqual([88, 28, 240, 28])
    expect(restored.map((item) => item.start)).toEqual([0, 88, 116, 356])
  })

  test("keeps non-thinking measurements and end fields consistent", () => {
    const snapshot = [
      { index: 0, key: "user-message:m1", start: 0, size: 88, end: 88 },
      { index: 1, key: "thinking:m1", start: 88, size: 300, end: 388 },
    ]
    const restored = normalizeThinkingMeasurements(snapshot)
    expect(restored[0]).toEqual({ index: 0, key: "user-message:m1", start: 0, size: 88, end: 88 })
    expect(restored[1]).toMatchObject({ size: 28, start: 88, end: 116 })
  })

  test("returns the input untouched when no thinking rows are present", () => {
    const snapshot = [
      { index: 0, key: "user-message:m1", start: 0, size: 88 },
      { index: 1, key: "assistant-part:m1:g1", start: 88, size: 240 },
    ]
    expect(normalizeThinkingMeasurements(snapshot)).toBe(snapshot)
  })
})
