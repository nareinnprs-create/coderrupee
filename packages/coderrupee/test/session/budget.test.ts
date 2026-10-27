import { describe, expect, test } from "bun:test"
import { SessionBudget } from "../../src/session/budget"

describe("session.budget resolve", () => {
  test("returns undefined when config budget is absent", () => {
    expect(SessionBudget.resolve(undefined)).toBeUndefined()
  })

  test("returns undefined when sessionMaxUsd is absent even with other keys", () => {
    expect(SessionBudget.resolve({ totalMaxUsd: 10, warnAt: 0.5, action: "stop" })).toBeUndefined()
  })

  test("returns undefined for zero, negative, and non-finite limits", () => {
    expect(SessionBudget.resolve({ sessionMaxUsd: 0 })).toBeUndefined()
    expect(SessionBudget.resolve({ sessionMaxUsd: -1 })).toBeUndefined()
    expect(SessionBudget.resolve({ sessionMaxUsd: Number.NaN })).toBeUndefined()
    expect(SessionBudget.resolve({ sessionMaxUsd: Number.POSITIVE_INFINITY })).toBeUndefined()
  })

  test("applies defaults for warnAt and action", () => {
    const resolved = SessionBudget.resolve({ sessionMaxUsd: 5 })
    expect(resolved).toEqual({ limits: { sessionMaxUsd: 5, warnAt: 0.8 }, action: "stop" })
  })

  test("keeps a valid warnAt and explicit action", () => {
    const resolved = SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: 0.25, action: "warn-only" })
    expect(resolved).toEqual({ limits: { sessionMaxUsd: 5, warnAt: 0.25 }, action: "warn-only" })
  })

  test("accepts warnAt at the boundaries 0.0001 and 1", () => {
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: 0.0001 })?.limits.warnAt).toBe(0.0001)
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: 1 })?.limits.warnAt).toBe(1)
  })

  test("falls back to the default warnAt for zero, negative, above one, and non-finite values", () => {
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: 0 })?.limits.warnAt).toBe(0.8)
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: -0.5 })?.limits.warnAt).toBe(0.8)
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: 1.5 })?.limits.warnAt).toBe(0.8)
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: Number.NaN })?.limits.warnAt).toBe(0.8)
    expect(SessionBudget.resolve({ sessionMaxUsd: 5, warnAt: Number.POSITIVE_INFINITY })?.limits.warnAt).toBe(0.8)
  })
})

describe("session.budget normalizeWarnAt", () => {
  test("keeps values in (0, 1]", () => {
    expect(SessionBudget.normalizeWarnAt(undefined)).toBe(0.8)
    expect(SessionBudget.normalizeWarnAt(0.5)).toBe(0.5)
    expect(SessionBudget.normalizeWarnAt(1)).toBe(1)
  })

  test("replaces invalid values with the default", () => {
    expect(SessionBudget.normalizeWarnAt(0)).toBe(0.8)
    expect(SessionBudget.normalizeWarnAt(-1)).toBe(0.8)
    expect(SessionBudget.normalizeWarnAt(2)).toBe(0.8)
    expect(SessionBudget.normalizeWarnAt(Number.NaN)).toBe(0.8)
  })
})

describe("session.budget evaluate", () => {
  const evaluate = (spent: number, limit = 10, warnAt = 0.8) => SessionBudget.evaluate({ spent, limit, warnAt })

  test("ok below the warn threshold", () => {
    expect(evaluate(1)).toEqual({ level: "ok", message: undefined })
    expect(evaluate(7.9)).toEqual({ level: "ok", message: undefined })
  })

  test("warn at exactly the warn threshold (equality boundary)", () => {
    const result = evaluate(8, 10, 0.8)
    expect(result.level).toBe("warn")
    expect(result.message).toContain("$8.00")
    expect(result.message).toContain("$10.00")
    expect(result.message).toContain("80%")
  })

  test("warn between warn threshold and limit", () => {
    expect(evaluate(9.99).level).toBe("warn")
  })

  test("exceeded at exactly the limit (equality boundary)", () => {
    const result = evaluate(10, 10, 0.8)
    expect(result.level).toBe("exceeded")
    expect(result.message).toContain("$10.00")
    expect(result.message).toContain("$10.00")
  })

  test("exceeded above the limit", () => {
    expect(evaluate(100).level).toBe("exceeded")
  })

  test("exceeded wins when warnAt is 1 and spent equals the limit", () => {
    expect(evaluate(10, 10, 1).level).toBe("exceeded")
  })

  test("warnAt 1 has no warn zone below the limit", () => {
    expect(evaluate(9.999, 10, 1).level).toBe("ok")
    expect(evaluate(10, 10, 1).level).toBe("exceeded")
  })

  test("zero spent is ok", () => {
    expect(evaluate(0).level).toBe("ok")
  })

  test("negative spent is ok", () => {
    expect(evaluate(-1).level).toBe("ok")
  })

  test("non-finite spent is ok", () => {
    expect(evaluate(Number.NaN).level).toBe("ok")
    expect(evaluate(Number.POSITIVE_INFINITY).level).toBe("ok")
  })

  test("a zero limit exceeds any positive spent", () => {
    expect(evaluate(0.01, 0, 0.8).level).toBe("exceeded")
  })

  test("a fractional limit and threshold evaluate with exact math", () => {
    const result = evaluate(0.02, 0.03, 0.5)
    expect(result.level).toBe("warn")
    const exceeded = evaluate(0.03, 0.03, 0.5)
    expect(exceeded.level).toBe("exceeded")
  })

  test("messages state spent and limit as USD", () => {
    const exceeded = evaluate(12.5, 10, 0.8)
    expect(exceeded.message).toBe("Session cost budget exceeded: spent $12.50 of the $10.00 limit.")
    const warn = evaluate(8.25, 10, 0.8)
    expect(warn.message).toBe("Session cost at $8.25 of the $10.00 budget (80% warn threshold).")
  })
})

describe("session.budget firstNotice", () => {
  test("returns true once per session and level, then false", () => {
    SessionBudget.clearNotices("ses_notice")
    expect(SessionBudget.firstNotice("ses_notice", "warn")).toBe(true)
    expect(SessionBudget.firstNotice("ses_notice", "warn")).toBe(false)
    expect(SessionBudget.firstNotice("ses_notice", "exceeded")).toBe(true)
    expect(SessionBudget.firstNotice("ses_notice", "exceeded")).toBe(false)
  })

  test("levels are latched independently per session", () => {
    SessionBudget.clearNotices("ses_notice_a")
    SessionBudget.clearNotices("ses_notice_b")
    expect(SessionBudget.firstNotice("ses_notice_a", "warn")).toBe(true)
    expect(SessionBudget.firstNotice("ses_notice_b", "warn")).toBe(true)
  })

  test("clearNotices without an argument resets every session", () => {
    SessionBudget.clearNotices()
    expect(SessionBudget.firstNotice("ses_notice_c", "warn")).toBe(true)
    SessionBudget.clearNotices()
    expect(SessionBudget.firstNotice("ses_notice_c", "warn")).toBe(true)
  })
})
