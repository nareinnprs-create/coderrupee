import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { rollbackSupported, rollbackTarget, shouldNotify } from "../../src/cli/upgrade"
import { UpgradeCommand } from "../../src/cli/cmd/upgrade"

const base = { autoupdate: undefined, disabled: false, always: false, current: "1.4.0", latest: "1.4.1" }

describe("upgrade check", () => {
  test("notifies about every newer same-major release, including patches", () => {
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, latest: "1.10.0" })).toBe(true)
  })

  test("does not treat a newer major or an older release as an update", () => {
    expect(shouldNotify({ ...base, latest: "2.0.0" })).toBe(false)
    expect(shouldNotify({ ...base, latest: "1.3.9" })).toBe(false)
  })

  test("treats true and notify the same", () => {
    expect(shouldNotify({ ...base, autoupdate: true })).toBe(true)
    expect(shouldNotify({ ...base, autoupdate: "notify" })).toBe(true)
  })

  test("does not notify when already on the latest version", () => {
    expect(shouldNotify({ ...base, latest: "1.4.0" })).toBe(false)
  })

  test("never notifies when update checks are disabled", () => {
    expect(shouldNotify({ ...base, autoupdate: false })).toBe(false)
    expect(shouldNotify({ ...base, disabled: true, always: true })).toBe(false)
  })

  test("always-notify flag forces a notice for the current version", () => {
    expect(shouldNotify({ ...base, latest: "1.4.0", always: true })).toBe(true)
  })
})

describe("rollback", () => {
  test("supports only package-manager installs that carry coderrupee-ai versions", () => {
    expect(rollbackSupported("npm")).toBe(true)
    expect(rollbackSupported("yarn")).toBe(true)
    expect(rollbackSupported("pnpm")).toBe(true)
    expect(rollbackSupported("bun")).toBe(true)
    expect(rollbackSupported("curl")).toBe(false)
    expect(rollbackSupported("brew")).toBe(false)
    expect(rollbackSupported("choco")).toBe(false)
    expect(rollbackSupported("scoop")).toBe(false)
    expect(rollbackSupported("unknown")).toBe(false)
  })

  test("targets the version recorded before the most recent update", () => {
    expect(rollbackTarget([])).toBeUndefined()
    expect(
      rollbackTarget([
        { fromVersion: "1.4.0", toVersion: "1.4.1", channel: "stable", date: "2026-10-27" },
        { fromVersion: "1.4.1", toVersion: "1.4.2", channel: "beta", date: "2026-10-28" },
      ]),
    ).toBe("1.4.1")
  })
})

describe("upgrade --rollback arg parsing", () => {
  // Register the real command with a no-op handler so parsing never runs the upgrade itself.
  const parse = (argv: string) =>
    yargs([])
      .command({ ...UpgradeCommand, handler: () => {} })
      .parseSync(argv) as Record<string, unknown>

  test("parses --rollback as a boolean flag", () => {
    const parsed = parse("upgrade --rollback")
    expect(parsed["rollback"]).toBe(true)
    expect(parsed["target"]).toBeUndefined()
  })

  test("defaults rollback to unset without the flag", () => {
    expect(parse("upgrade")["rollback"]).toBeUndefined()
  })

  test("keeps an explicit target and --rollback independent", () => {
    const parsed = parse("upgrade 1.4.1 --rollback")
    expect(parsed["rollback"]).toBe(true)
    expect(parsed["target"]).toBe("1.4.1")
  })
})
