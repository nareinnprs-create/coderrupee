import { describe, expect, test } from "bun:test"
import { parseDeepLinksFromArgv } from "./deep-links"

describe("parseDeepLinksFromArgv", () => {
  test("extracts coderrupee:// urls from a cold-start argv", () => {
    expect(
      parseDeepLinksFromArgv([
        "C:\\app\\CoderRupee.exe",
        "--allow-file-access-from-files",
        "coderrupee://server/add?url=https%3A%2F%2Fexample.com",
      ]),
    ).toEqual(["coderrupee://server/add?url=https%3A%2F%2Fexample.com"])
  })

  test("keeps the relative order of multiple urls", () => {
    expect(parseDeepLinksFromArgv(["coderrupee://a", "x", "coderrupee://b"])).toEqual([
      "coderrupee://a",
      "coderrupee://b",
    ])
  })

  test("returns empty for a plain launch", () => {
    expect(parseDeepLinksFromArgv(["C:\\app\\CoderRupee.exe"])).toEqual([])
    expect(parseDeepLinksFromArgv([])).toEqual([])
  })

  test("ignores lookalike schemes and case variants", () => {
    expect(parseDeepLinksFromArgv(["CODERRUPEE://server", "coderrupee:/path", "xcoderrupee://x"])).toEqual([])
  })
})
