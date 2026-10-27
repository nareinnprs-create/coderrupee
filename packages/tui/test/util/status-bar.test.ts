import { describe, expect, test } from "bun:test"
import { branchLabel, contextUsage, costLabel, modelLabel } from "../../src/util/status-bar"

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
