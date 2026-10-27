import { describe, expect, test } from "bun:test"
import { durationParts } from "./duration"

describe("duration parts", () => {
  test("formats sub-minute durations as seconds", () => {
    expect(durationParts(0)).toEqual({ kind: "seconds", count: 0 })
    expect(durationParts(42_400)).toEqual({ kind: "seconds", count: 42 })
  })

  test("rounds and switches to minutes plus seconds at one minute", () => {
    expect(durationParts(59_400)).toEqual({ kind: "seconds", count: 59 })
    expect(durationParts(59_900)).toEqual({ kind: "minutesSeconds", minutes: 1, seconds: 0 })
    expect(durationParts(192_000)).toEqual({ kind: "minutesSeconds", minutes: 3, seconds: 12 })
  })

  test("never returns negative parts", () => {
    expect(durationParts(-5)).toEqual({ kind: "seconds", count: 0 })
  })
})
