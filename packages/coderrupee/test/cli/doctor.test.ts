import { describe, expect, test } from "bun:test"
import { DoctorCommand, runDoctor } from "../../src/cli/cmd/doctor"
import { command, mockContext } from "../doctor/mock"

// Context where every check passes, mirroring test/doctor/registry.test.ts.
const healthyContext = () =>
  mockContext({
    detectMethod: async () => "npm",
    runCommand: async (file, args) => {
      if (file !== "git") return command(file === "bun" ? "1.3.14" : "v22.14.0")
      if (args[0] === "rev-parse") return command("true\n")
      if (args[0] === "branch") return command("main\n")
      return command("")
    },
    exists: async () => true,
    readFile: async (file) =>
      file.endsWith("auth.json") ? JSON.stringify({ openai: { type: "api", key: "sk" } }) : "{}",
    statfs: async () => ({ bsize: 4096, bavail: (100 * 1024 * 1024 * 1024) / 4096 }),
  })

describe("doctor command", () => {
  test("registers as a plain doctor command with json and strict options", () => {
    expect(DoctorCommand.command).toBe("doctor")
    expect(DoctorCommand.describe).toContain("health")
    expect(typeof DoctorCommand.builder).toBe("function")
    expect(typeof DoctorCommand.handler).toBe("function")
  })

  test("returns the report and keeps the exit code clean by default", async () => {
    const previous = process.exitCode
    process.exitCode = 0
    try {
      const report = await runDoctor({ json: true, context: mockContext() })
      expect(report.checks).toHaveLength(7)
      expect(process.exitCode).toBe(0)
    } finally {
      process.exitCode = previous
    }
  })

  test("strict mode fails the exit code on warn or fail results", async () => {
    const previous = process.exitCode
    process.exitCode = 0
    try {
      await runDoctor({
        json: true,
        strict: true,
        context: mockContext({ accessWritable: async () => false, exists: async () => true }),
      })
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previous
    }
  })

  test("strict mode exits 0 on a healthy report", async () => {
    const previous = process.exitCode
    process.exitCode = 0
    try {
      await runDoctor({ json: true, strict: true, context: healthyContext() })
      expect(process.exitCode).toBe(0)
    } finally {
      process.exitCode = previous
    }
  }, 30000)
})
