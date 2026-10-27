import { describe, expect, test } from "bun:test"
import { InvalidAppNameError, sanitizeAppName } from "./app-name"

const invalid = (value: unknown) => () => sanitizeAppName(value as string)

describe("sanitizeAppName", () => {
  test("accepts plain app names", () => {
    expect(sanitizeAppName("git")).toBe("git")
    expect(sanitizeAppName("Visual Studio Code")).toBe("Visual Studio Code")
    expect(sanitizeAppName("my-app_v2.exe".replace(".exe", ""))).toBe("my-app_v2")
    expect(sanitizeAppName("App.Name")).toBe("App.Name")
  })

  test("rejects empty and whitespace-only names", () => {
    expect(invalid("")).toThrow(InvalidAppNameError)
    expect(invalid("   ")).toThrow(InvalidAppNameError)
  })

  test("rejects traversal attempts", () => {
    expect(invalid("..\\..\\x")).toThrow(InvalidAppNameError)
    expect(invalid("../../etc/passwd")).toThrow(InvalidAppNameError)
    expect(invalid("..")).toThrow(InvalidAppNameError)
    expect(invalid(".")).toThrow(InvalidAppNameError)
    expect(invalid("foo/../bar")).toThrow(InvalidAppNameError)
    expect(invalid("foo/../../x")).toThrow(InvalidAppNameError)
  })

  test("rejects absolute paths", () => {
    expect(invalid("C:\\evil")).toThrow(InvalidAppNameError)
    expect(invalid("C:/evil")).toThrow(InvalidAppNameError)
    expect(invalid("/usr/bin/evil")).toThrow(InvalidAppNameError)
    expect(invalid("\\\\server\\share\\evil")).toThrow(InvalidAppNameError)
  })

  test("rejects path separators", () => {
    expect(invalid("foo/bar")).toThrow(InvalidAppNameError)
    expect(invalid("foo\\bar")).toThrow(InvalidAppNameError)
  })

  test("rejects names outside the allowed charset", () => {
    expect(invalid("git;rm -rf")).toThrow(InvalidAppNameError)
    expect(invalid("git|cmd")).toThrow(InvalidAppNameError)
    expect(invalid("git\n-x")).toThrow(InvalidAppNameError)
    expect(invalid("café")).toThrow(InvalidAppNameError)
  })

  test("rejects oversized names", () => {
    expect(invalid("a".repeat(129))).toThrow(InvalidAppNameError)
    expect(sanitizeAppName("a".repeat(128))).toBe("a".repeat(128))
  })
})
