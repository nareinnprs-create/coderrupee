import { describe, expect, test } from "bun:test"
import { shouldVirtualizeReviewDiff } from "@coderrupee/session-ui/v2/session-review-file-preview-v2-virtualize"

describe("TimelineDiffView virtualization", () => {
  test("virtualizes a diff when either side exceeds 500 lines", () => {
    expect(shouldVirtualizeReviewDiff({ additionLines: 500, deletionLines: 500 })).toBe(false)
    expect(shouldVirtualizeReviewDiff({ additionLines: 501, deletionLines: 0 })).toBe(true)
    expect(shouldVirtualizeReviewDiff({ additionLines: 0, deletionLines: 501 })).toBe(true)
  })
})
