import { describe, expect, test } from "bun:test"
import { cspHeader, cspPolicy, resolveCspMode } from "./csp"

describe("resolveCspMode", () => {
  test("defaults to report-only", () => {
    expect(resolveCspMode(undefined)).toBe("report-only")
    expect(resolveCspMode("")).toBe("report-only")
    expect(resolveCspMode("ENFORCE")).toBe("report-only")
    expect(resolveCspMode("off")).toBe("report-only")
  })

  test("enforce switches the mode", () => {
    expect(resolveCspMode("enforce")).toBe("enforce")
  })
})

describe("cspPolicy", () => {
  const prod = cspPolicy(false)
  const dev = cspPolicy(true)

  test("keeps the strict prod baseline", () => {
    expect(prod).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws://127.0.0.1:* ws://localhost:* wss:; " +
        "font-src 'self' data:; frame-ancestors 'none'",
    )
  })

  test("dev branch widens script-src for the vite dev server without touching prod", () => {
    expect(dev).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(prod).toContain("script-src 'self'")
    expect(prod).not.toContain("unsafe-eval")
    expect(dev.replace("script-src 'self' 'unsafe-inline' 'unsafe-eval'", "script-src 'self'")).toBe(prod)
  })

  test("allows the local sidecar and wss but no plain http hosts", () => {
    for (const policy of [prod, dev]) {
      expect(policy).toContain("http://127.0.0.1:*")
      expect(policy).toContain("ws://localhost:*")
      expect(policy).toContain("wss:")
      expect(policy).toContain("frame-ancestors 'none'")
    }
  })
})

describe("cspHeader", () => {
  test("report-only mode uses the report-only header", () => {
    expect(cspHeader(false, "report-only").name).toBe("Content-Security-Policy-Report-Only")
  })

  test("enforce mode uses the enforcing header with the same policy", () => {
    const header = cspHeader(false, "enforce")
    expect(header.name).toBe("Content-Security-Policy")
    expect(header.value).toBe(cspPolicy(false))
  })
})
