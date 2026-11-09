import type { PermissionV1 } from "@coderrupee/core/v1/permission"

export const Tier = ["T0", "T1", "T2", "T3"] as const

export type Tier = (typeof Tier)[number]

export const actionTier: Record<string, Tier> = {
  read: "T0",
  glob: "T0",
  grep: "T0",
  list: "T0",
  websearch: "T0",
  webfetch: "T0",
  edit: "T1",
  write: "T1",
  apply_patch: "T1",
  task: "T1",
  todowrite: "T1",
  bash: "T2",
  browser: "T2",
  input: "T2",
  net: "T2",
  os: "T2",
  screen: "T2",
  window: "T2",
  "delete-outside": "T3",
  credentials: "T3",
  elevate: "T3",
  "mass-auto": "T3",
  "sec-exploit": "T3",
}

export function getTier(action: string): Tier {
  return actionTier[action] ?? "T2"
}

export function applyTierFloor(action: PermissionV1.Rule["action"], permission: string): PermissionV1.Rule["action"] {
  if (action === "deny") return action
  if (getTier(permission) === "T0" || getTier(permission) === "T1") return action
  return "ask"
}

export * as PermissionTier from "./tier"
