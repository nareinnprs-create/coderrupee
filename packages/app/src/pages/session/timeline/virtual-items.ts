export function filterVirtualIndexes(indexes: number[], count: number) {
  return indexes.filter((index) => index >= 0 && index < count)
}

// Typical rendered heights per row tag. A flat estimate misjudges cheap rows
// (TurnGap) and heavy rows (AssistantPart) by 2-10x, which skews the initial
// total size, the bottom-anchor landing, and every first measurement correction.
// Measured sizes always override these once a row has been observed.
export function estimateRowSize(row: { _tag: string }) {
  switch (row._tag) {
    case "TurnGap":
      return 24
    case "TurnDivider":
      return 33
    case "Thinking":
      return 28
    case "UserMessage":
      return 88
    case "CommentStrip":
      return 48
    case "AssistantPart":
      return 240
    case "DiffSummary":
      return 64
    case "Retry":
      return 48
    case "Error":
      return 60
    default:
      return undefined
  }
}

type SnapshotItem = { index: number; key: unknown; start: number; size: number }

// A snapshot captured while reasoning rows were streaming holds their expanded
// heights under stable keys; restored verbatim, since-collapsed rows start
// hundreds of pixels too tall (variable-height measurement staleness). Rewrite
// Thinking-row sizes to the collapsed estimate and rebuild the prefix offsets
// so the restored cache stays index-aligned.
export function normalizeThinkingMeasurements<T extends SnapshotItem>(items: T[]): T[] {
  const collapsedSize = estimateRowSize({ _tag: "Thinking" })
  const isThinking = (item: SnapshotItem) => typeof item.key === "string" && item.key.startsWith("thinking:")
  if (!collapsedSize || !items.some(isThinking)) return items
  let start = 0
  return [...items]
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      const size = isThinking(item) ? collapsedSize : item.size
      const next: T = { ...item, size, start }
      if ("end" in item) (next as unknown as { end: number }).end = start + size
      start += size
      return next
    })
}
