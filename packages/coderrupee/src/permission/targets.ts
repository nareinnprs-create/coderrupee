export type TargetKind = "self" | "account" | "third-party"

export interface TargetGrant {
  readonly id: string
  readonly kind: TargetKind
  readonly scopes: ReadonlyArray<string>
  readonly expiresAt?: number
}

export function isTargetAuthorized(
  target: string,
  scope: string,
  grants: ReadonlyArray<TargetGrant>,
  now = Date.now(),
): boolean {
  const grant = grants.find((item) => item.id === target)
  if (!grant) return false
  if (grant.kind === "third-party" && grant.expiresAt === undefined) return false
  if (grant.expiresAt !== undefined && grant.expiresAt <= now) return false
  return grant.scopes.some((item) => item === "*" || item === scope)
}

export * as PermissionTargets from "./targets"
