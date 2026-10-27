import { describe, expect, test } from "bun:test"
import { branchLabel, contextUsage, costBudget, costLabel, costWarned, modelLabel } from "../../src/util/status-bar"

const tokens = (input: number, output: number, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

describe("util.status-bar", () => {
  describe("modelLabel", () => {
    test("returns the model id in short form", () => {
      expect(modelLabel({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })).toBe("claude-sonnet-4-5")
    })

    test("returns undefined when no model is selected", () => {
      expect(modelLabel(undefined)).toBeUndefined()
    })

    test("returns undefined for blank model ids", () => {
      expect(modelLabel({ providerID: "anthropic", modelID: "  " })).toBeUndefined()
    })
  })

  describe("contextUsage", () => {
    test("returns percent of context limit over all token classes", () => {
      expect(contextUsage(tokens(100, 20, 10, 50, 20), 1000)).toBe(20)
    })

    test("rounds to nearest integer", () => {
      expect(contextUsage(tokens(1, 0), 3)).toBe(33)
      expect(contextUsage(tokens(2, 0), 3)).toBe(67)
    })

    test("returns undefined without tokens or limit", () => {
      expect(contextUsage(undefined, 1000)).toBeUndefined()
      expect(contextUsage(tokens(10, 10), undefined)).toBeUndefined()
    })

    test("returns undefined for zero or negative limits and token totals", () => {
      expect(contextUsage(tokens(10, 10), 0)).toBeUndefined()
      expect(contextUsage(tokens(10, 10), -5)).toBeUndefined()
      expect(contextUsage(tokens(0, 0), 1000)).toBeUndefined()
    })
  })

  describe("costLabel", () => {
    test("formats a positive cost as USD currency", () => {
      expect(costLabel(1.5)).toBe("$1.50")
    })

    test("returns undefined for missing, zero, or negative cost", () => {
      expect(costLabel(undefined)).toBeUndefined()
      expect(costLabel(0)).toBeUndefined()
      expect(costLabel(-1)).toBeUndefined()
    })
  })

  describe("costBudget", () => {
    test("reads the budget object from a raw config value", () => {
      expect(costBudget({ budget: { sessionMaxUsd: 5 } })).toEqual({ sessionMaxUsd: 5 })
    })

    test("returns undefined without a budget key or a config object", () => {
      expect(costBudget(undefined)).toBeUndefined()
      expect(costBudget({})).toBeUndefined()
      expect(costBudget({ budget: "nope" })).toBeUndefined()
      expect(costBudget("config")).toBeUndefined()
    })
  })

  describe("costWarned", () => {
    test("false below the default warn threshold", () => {
      expect(costWarned(0.79, { sessionMaxUsd: 1 })).toBe(false)
    })

    test("true at exactly the warn threshold (0.8 default)", () => {
      expect(costWarned(0.8, { sessionMaxUsd: 1 })).toBe(true)
    })

    test("honors a custom warnAt with the same equality boundary", () => {
      expect(costWarned(0.49, { sessionMaxUsd: 1, warnAt: 0.5 })).toBe(false)
      expect(costWarned(0.5, { sessionMaxUsd: 1, warnAt: 0.5 })).toBe(true)
    })

    test("falls back to the default warnAt for invalid values", () => {
      expect(costWarned(0.5, { sessionMaxUsd: 1, warnAt: 0 })).toBe(false)
      expect(costWarned(0.8, { sessionMaxUsd: 1, warnAt: 0 })).toBe(true)
      expect(costWarned(0.8, { sessionMaxUsd: 1, warnAt: 2 })).toBe(true)
      expect(costWarned(0.8, { sessionMaxUsd: 1, warnAt: Number.NaN })).toBe(true)
    })

    test("false without cost or without a usable limit", () => {
      expect(costWarned(undefined, { sessionMaxUsd: 1 })).toBe(false)
      expect(costWarned(0, { sessionMaxUsd: 1 })).toBe(false)
      expect(costWarned(-1, { sessionMaxUsd: 1 })).toBe(false)
      expect(costWarned(1, undefined)).toBe(false)
      expect(costWarned(1, {})).toBe(false)
      expect(costWarned(1, { sessionMaxUsd: 0 })).toBe(false)
      expect(costWarned(1, { sessionMaxUsd: -5 })).toBe(false)
    })

    test("true beyond the limit", () => {
      expect(costWarned(2, { sessionMaxUsd: 1 })).toBe(true)
    })
  })

  describe("branchLabel", () => {
    test("returns the branch name", () => {
      expect(branchLabel("main")).toBe("main")
      expect(branchLabel("feature/some-branch")).toBe("feature/some-branch")
    })

    test("returns undefined for missing or blank branches", () => {
      expect(branchLabel(undefined)).toBeUndefined()
      expect(branchLabel("")).toBeUndefined()
      expect(branchLabel("   ")).toBeUndefined()
    })
  })
})
