import { describe, expect, test } from "bun:test"
import { Doctor } from "../../src/doctor"
import type { DoctorContext } from "../../src/doctor"
import { command, mockContext } from "./mock"

// Context where every check passes: npm install, both runtimes, one valid
// provider, an empty valid config, a clean repo, writable dirs, ample disk.
const healthy = {
  detectMethod: async () => "npm" as const,
  runCommand: async (file: string, args: string[]) => {
    if (file !== "git") return command(file === "bun" ? "1.3.14" : "v22.14.0")
    if (args[0] === "rev-parse") return command("true\n")
    if (args[0] === "branch") return command("main\n")
    return command("")
  },
  exists: async () => true,
  readFile: async (file: string) =>
    file.endsWith("auth.json") ? JSON.stringify({ openai: { type: "api", key: "sk" } }) : "{}",
  statfs: async () => ({ bsize: 4096, bavail: (100 * 1024 * 1024 * 1024) / 4096 }),
}

function healthyContext(overrides: Partial<DoctorContext> = {}) {
  return mockContext({ ...healthy, ...overrides })
}

describe("doctor registry", () => {
  test("registers seven checks with unique ids", () => {
    const ids = Doctor.checks.map((check) => check.id)
    expect(ids).toEqual(["installation", "runtime", "auth", "config", "project", "storage", "disk"])
    expect(new Set(ids).size).toBe(ids.length)
    for (const check of Doctor.checks) expect(check.label.length).toBeGreaterThan(0)
  })

  test("runs every check and aggregates counts", async () => {
    const saved = process.env.CODERRUPEE_AUTH_CONTENT
    delete process.env.CODERRUPEE_AUTH_CONTENT
    try {
      const report = await Doctor.runChecks({ context: healthyContext() })
      expect(report.checks).toHaveLength(7)
      expect(report.counts).toEqual({ pass: 7, warn: 0, fail: 0, info: 0 })
      expect(report.ok).toBe(true)
    } finally {
      if (saved !== undefined) process.env.CODERRUPEE_AUTH_CONTENT = saved
    }
  }, 30000)

  test("marks the report not ok when a check warns or fails", async () => {
    const warnOnly = await Doctor.runChecks({ context: healthyContext({ statfs: async () => ({ bsize: 4096, bavail: (500 * 1024 * 1024) / 4096 }) }) })
    expect(warnOnly.ok).toBe(false)
    expect(warnOnly.counts.warn).toBe(1)

    const failing = await Doctor.runChecks({
      context: healthyContext({ accessWritable: async () => false }),
    })
    expect(failing.ok).toBe(false)
    expect(failing.counts.fail).toBeGreaterThan(0)
  }, 30000)

  test("contains a crashing check as a fail result without skipping the rest", async () => {
    const report = await Doctor.runChecks({
      context: healthyContext({
        exists: async (file) => {
          if (file.endsWith("auth.json")) throw new Error("fs exploded")
          return file.endsWith("coderrupee.jsonc")
        },
      }),
    })
    expect(report.checks).toHaveLength(7)
    const auth = report.checks.find((check) => check.id === "auth")
    expect(auth?.status).toBe("fail")
    expect(auth?.detail).toContain("fs exploded")
    expect(report.checks.find((check) => check.id === "config")?.status).toBe("pass")
  }, 30000)
})
