import { describe, expect, test } from "bun:test"
import { EditReplace } from "@coderrupee/core/tool/edit-replace"

describe("EditReplace", () => {
  test("matches exactly and maps replacement through the region", () => {
    const { matches, replace } = EditReplace.matchView("before\nrest\n", "before", "after")
    expect(matches).toEqual([{ start: 0, end: 6 }])
    expect(replace(matches[0]!)).toBe("after")
  })

  test("matches while ignoring trailing whitespace on each line", () => {
    const source = "function example() {\n    alpha   \n    beta\n}\n"
    const { matches, replace } = EditReplace.matchView(source, "    alpha\n    beta\n}", "    one\ntwo\n}")
    expect(matches).toHaveLength(1)
    const replaced = source.slice(0, matches[0]!.start) + replace(matches[0]!) + source.slice(matches[0]!.end)
    expect(replaced).toBe("function example() {\n    one\ntwo\n}\n")
  })

  test("matches after normalizing typographic quote and dash variants", () => {
    const source = "const value = \u201Cfirst\u201D \u2013 second\n"
    const { matches, replace } = EditReplace.matchView(source, 'const value = "first" - second', "changed")
    expect(matches).toHaveLength(1)
    expect(replace(matches[0]!)).toBe("changed")
  })

  test("keeps CRLF line endings of the matched region", () => {
    const source = "before\r\nrest\r\n"
    const { matches, replace } = EditReplace.matchView(source, "before\nrest", "after\nrest")
    expect(matches).toEqual([{ start: 0, end: 12 }])
    const replaced = replace(matches[0]!)
    expect(replaced).toBe("after\r\nrest")
  })

  test("keeps mixed line endings of unchanged context inside the match", () => {
    const source = "alpha\r\nbeta\n"
    const { matches, replace } = EditReplace.matchView(source, "alpha\nbeta", "alpha\ngamma")
    expect(replace(matches[0]!)).toBe("alpha\r\ngamma")
  })

  test("finds multiple occurrences for replaceAll", () => {
    const { matches } = EditReplace.matchView("same same", "same", "x")
    expect(matches).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ])
  })

  test("missHint reports an already-applied replacement", () => {
    const hint = EditReplace.missHint(
      "already applied content that is long enough here\n",
      "previous text",
      "already applied content that is long enough here",
    )
    expect(hint).toBe("newString is already in the file, so this edit may already be applied.")
  })

  test("missHint shows the closest numbered lines when half the lines vote for one position", () => {
    const source = "keep\nfirst line\nsecond line\nkeep\n"
    const hint = EditReplace.missHint(source, "first line\nsecond lin", "replacement")
    // Only matched lines are shown, so padding oldString cannot reveal later lines.
    expect(hint).toContain("The closest lines in the file:")
    expect(hint).toContain("2: first line")
    expect(hint).not.toContain("3: second line")
  })

  test("missHint returns undefined without a confident position", () => {
    expect(EditReplace.missHint("unrelated\n", "missing text", "replacement")).toBeUndefined()
  })
})
