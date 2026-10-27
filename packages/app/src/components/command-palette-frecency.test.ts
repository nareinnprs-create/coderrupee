import { describe, expect, test } from "bun:test"
import { commandFrecencyScore, rankCommandPaletteCommands } from "./command-palette-frecency"

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const HALF_LIFE_MS = 3 * 24 * HOUR

const items = (ids: string[]) => ids.map((id) => ({ id }))

describe("commandFrecencyScore", () => {
  test("scores commands without history as zero", () => {
    expect(commandFrecencyScore(undefined, NOW)).toBe(0)
    expect(commandFrecencyScore({ count: 0, lastUsedAt: NOW }, NOW)).toBe(0)
    expect(commandFrecencyScore({ count: -1, lastUsedAt: NOW }, NOW)).toBe(0)
  })

  test("a single fresh use scores 1", () => {
    expect(commandFrecencyScore({ count: 1, lastUsedAt: NOW }, NOW)).toBe(1)
  })

  test("score decays by half every half-life", () => {
    expect(commandFrecencyScore({ count: 2, lastUsedAt: NOW - HALF_LIFE_MS }, NOW)).toBeCloseTo(1)
    expect(commandFrecencyScore({ count: 1, lastUsedAt: NOW - 2 * HALF_LIFE_MS }, NOW)).toBeCloseTo(0.25)
  })

  test("stale entries decay toward zero but stay non-negative", () => {
    const stale = commandFrecencyScore({ count: 1, lastUsedAt: NOW - 30 * HALF_LIFE_MS }, NOW)
    expect(stale).toBeGreaterThan(0)
    expect(stale < 0.001).toBe(true)
  })

  test("usage recorded in the future is clamped to full score", () => {
    expect(commandFrecencyScore({ count: 3, lastUsedAt: NOW + HOUR }, NOW)).toBe(3)
  })
})

describe("rankCommandPaletteCommands", () => {
  test("keeps the original order and does not mutate input without usage history", () => {
    const list = items(["session.new", "workspace.new", "terminal.toggle"])
    const ranked = rankCommandPaletteCommands(list, {}, NOW)
    expect(ranked.map((item) => item.id)).toEqual(["session.new", "workspace.new", "terminal.toggle"])
    expect(list.map((item) => item.id)).toEqual(["session.new", "workspace.new", "terminal.toggle"])
  })

  test("floats a single used command to the top", () => {
    const list = items(["a", "b", "c"])
    const usage = { b: { count: 1, lastUsedAt: NOW } }
    expect(rankCommandPaletteCommands(list, usage, NOW).map((item) => item.id)).toEqual(["b", "a", "c"])
  })

  test("breaks ties stably by keeping registration order", () => {
    const list = items(["a", "b", "c"])
    const usage = {
      c: { count: 2, lastUsedAt: NOW - HOUR },
      a: { count: 2, lastUsedAt: NOW - HOUR },
    }
    expect(rankCommandPaletteCommands(list, usage, NOW).map((item) => item.id)).toEqual(["a", "c", "b"])
  })

  test("ranks fresh use above stale use above never used", () => {
    const list = items(["stale", "fresh", "unused"])
    const usage = {
      stale: { count: 5, lastUsedAt: NOW - 30 * 24 * HOUR },
      fresh: { count: 1, lastUsedAt: NOW - HOUR },
    }
    expect(rankCommandPaletteCommands(list, usage, NOW).map((item) => item.id)).toEqual(["fresh", "stale", "unused"])
  })

  test("lets frequency outweigh mild recency differences", () => {
    const list = items(["once", "often"])
    const usage = {
      once: { count: 1, lastUsedAt: NOW },
      often: { count: 10, lastUsedAt: NOW - 6 * HOUR },
    }
    expect(rankCommandPaletteCommands(list, usage, NOW).map((item) => item.id)).toEqual(["often", "once"])
  })

  test("keeps unused commands in their original relative order after ranked ones", () => {
    const list = items(["a", "b", "c", "d", "e"])
    const usage = { d: { count: 1, lastUsedAt: NOW }, b: { count: 2, lastUsedAt: NOW - HOUR } }
    expect(rankCommandPaletteCommands(list, usage, NOW).map((item) => item.id)).toEqual(["b", "d", "a", "c", "e"])
  })

  test("only reorders: the ranked list is a permutation of the input", () => {
    const list = items(["a", "b", "c"])
    const usage = {
      a: { count: 3, lastUsedAt: NOW },
      c: { count: 1, lastUsedAt: NOW - 100 * 24 * HOUR },
    }
    const ranked = rankCommandPaletteCommands(list, usage, NOW)
    expect(ranked.map((item) => item.id).sort()).toEqual(["a", "b", "c"])
  })
})
