import { expect, test } from "bun:test"
import { PermissionTargets } from "../../src/permission/targets"

const now = Date.UTC(2026, 0, 1)

test("denies targets that are not registered", () => {
  expect(PermissionTargets.isTargetAuthorized("api.example.com", "scan", [], now)).toBe(false)
})

test("authorizes registered self and account targets within scope", () => {
  const grants = [
    { id: "local-machine", kind: "self", scopes: ["harden"] },
    { id: "github-account", kind: "account", scopes: ["*"] },
  ] as const

  expect(PermissionTargets.isTargetAuthorized("local-machine", "harden", grants, now)).toBe(true)
  expect(PermissionTargets.isTargetAuthorized("local-machine", "scan", grants, now)).toBe(false)
  expect(PermissionTargets.isTargetAuthorized("github-account", "scan", grants, now)).toBe(true)
})

test("requires third-party grants to be scoped and unexpired", () => {
  const grants = [
    { id: "missing-expiry", kind: "third-party", scopes: ["scan"] },
    { id: "expired", kind: "third-party", scopes: ["scan"], expiresAt: now },
    { id: "authorized", kind: "third-party", scopes: ["scan"], expiresAt: now + 1 },
  ] as const

  expect(PermissionTargets.isTargetAuthorized("missing-expiry", "scan", grants, now)).toBe(false)
  expect(PermissionTargets.isTargetAuthorized("expired", "scan", grants, now)).toBe(false)
  expect(PermissionTargets.isTargetAuthorized("authorized", "scan", grants, now)).toBe(true)
  expect(PermissionTargets.isTargetAuthorized("authorized", "harden", grants, now)).toBe(false)
})
