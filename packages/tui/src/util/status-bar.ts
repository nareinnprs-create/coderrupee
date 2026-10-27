import type { AssistantMessage } from "@coderrupee/sdk/v2"

export type StatusModel = {
  providerID: string
  modelID: string
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function modelLabel(model: StatusModel | undefined): string | undefined {
  const id = model?.modelID.trim()
  return id || undefined
}

export function contextUsage(
  tokens: AssistantMessage["tokens"] | undefined,
  contextLimit: number | undefined,
): number | undefined {
  if (!tokens || !contextLimit || contextLimit <= 0) return
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  if (total <= 0) return
  return Math.round((total / contextLimit) * 100)
}

export function costLabel(cost: number | undefined): string | undefined {
  if (!cost || cost <= 0) return
  return money.format(cost)
}

export type CostBudget = {
  sessionMaxUsd?: number
  warnAt?: number
}

const DEFAULT_WARN_AT = 0.8

/**
 * Reads the cost budget from the server config. Takes unknown because the
 * generated SDK config type does not carry `budget` yet; the field arrives as
 * plain JSON either way.
 */
export function costBudget(config: unknown): CostBudget | undefined {
  if (!config || typeof config !== "object") return
  const budget = (config as { budget?: unknown }).budget
  if (!budget || typeof budget !== "object") return
  return budget as CostBudget
}

/**
 * True when the session cost reached the warn threshold (limit * warnAt,
 * default 0.8). Mirrors the server-side budget guard semantics; an absent or
 * nonsensical limit means no warning.
 */
export function costWarned(cost: number | undefined, budget: CostBudget | undefined): boolean {
  const limit = budget?.sessionMaxUsd
  if (cost === undefined || !Number.isFinite(cost) || cost <= 0) return false
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return false
  const warnAt = budget?.warnAt
  const fraction = warnAt !== undefined && Number.isFinite(warnAt) && warnAt > 0 && warnAt <= 1 ? warnAt : DEFAULT_WARN_AT
  return cost >= limit * fraction
}

export function branchLabel(branch: string | undefined): string | undefined {
  const value = branch?.trim()
  return value || undefined
}
