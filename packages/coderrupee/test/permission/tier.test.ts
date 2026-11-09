import { expect, test } from "bun:test"
import { PermissionTier } from "../../src/permission/tier"

test("classifies roadmap actions by autonomy tier", () => {
  expect(PermissionTier.getTier("read")).toBe("T0")
  expect(PermissionTier.getTier("edit")).toBe("T1")
  expect(PermissionTier.getTier("browser")).toBe("T2")
  expect(PermissionTier.getTier("elevate")).toBe("T3")
  expect(PermissionTier.getTier("unknown-action")).toBe("T2")
})

test("raises T2 and T3 allows to approval", () => {
  expect(PermissionTier.applyTierFloor("allow", "read")).toBe("allow")
  expect(PermissionTier.applyTierFloor("allow", "edit")).toBe("allow")
  expect(PermissionTier.applyTierFloor("allow", "browser")).toBe("ask")
  expect(PermissionTier.applyTierFloor("allow", "elevate")).toBe("ask")
})

test("never weakens deny decisions", () => {
  expect(PermissionTier.applyTierFloor("deny", "read")).toBe("deny")
  expect(PermissionTier.applyTierFloor("deny", "browser")).toBe("deny")
})
