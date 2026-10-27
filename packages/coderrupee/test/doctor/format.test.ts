import { describe, expect, test } from "bun:test"
import { DoctorFormat } from "../../src/doctor/format"
import type { CheckResult, DoctorReport } from "../../src/doctor"

function check(overrides: Partial<CheckResult> = {}): CheckResult {
  return { id: "disk", label: "Disk", status: "pass", detail: "42.0 GiB free", ...overrides }
}

function report(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    checks: [check(), check({ id: "auth", label: "Auth", status: "warn", detail: "unreadable", hint: "re-auth" })],
    ok: false,
    counts: { pass: 1, warn: 1, fail: 0, info: 0 },
    ...overrides,
  }
}

describe("doctor format", () => {
  test("maps statuses to log levels", () => {
    expect(DoctorFormat.statusToLog("pass")).toBe("success")
    expect(DoctorFormat.statusToLog("warn")).toBe("warn")
    expect(DoctorFormat.statusToLog("fail")).toBe("error")
    expect(DoctorFormat.statusToLog("info")).toBe("info")
  })

  test("renders a check as label plus detail", () => {
    expect(DoctorFormat.formatCheckText(check())).toBe("Disk: 42.0 GiB free")
    expect(DoctorFormat.formatCheckText(check({ detail: undefined }))).toBe("Disk")
  })

  test("renders hints with a prefix", () => {
    expect(DoctorFormat.formatHint(check({ hint: "free up space" }))).toBe("hint: free up space")
    expect(DoctorFormat.formatHint(check())).toBeUndefined()
  })

  test("renders a summary of counts", () => {
    expect(DoctorFormat.formatSummary(report())).toBe("2 checks, 1 pass, 1 warn")
    const clean = report({ ok: true, counts: { pass: 7, warn: 0, fail: 0, info: 0 }, checks: [] })
    expect(DoctorFormat.formatSummary(clean)).toBe("0 checks, 7 pass")
  })

  test("serializes the machine report", () => {
    const parsed = JSON.parse(DoctorFormat.toJson(report()))
    expect(parsed.ok).toBe(false)
    expect(parsed.counts).toEqual({ pass: 1, warn: 1, fail: 0, info: 0 })
    expect(parsed.checks).toEqual([
      { id: "disk", label: "Disk", status: "pass", detail: "42.0 GiB free", hint: undefined },
      { id: "auth", label: "Auth", status: "warn", detail: "unreadable", hint: "re-auth" },
    ])
  })
})
