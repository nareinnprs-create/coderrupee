export * as SessionBudget from "./budget"

import type { ConfigV1 } from "@coderrupee/core/v1/config/config"

/**
 * Pure cost-budget evaluation for the session budget guard (A3).
 *
 * The guard is entirely additive: when no `sessionMaxUsd` limit is configured,
 * `resolve` returns undefined and every caller must treat budget enforcement
 * as disabled. Defaults: warnAt 0.8, action "stop".
 */

export type BudgetLevel = "ok" | "warn" | "exceeded"

export type BudgetAction = "stop" | "warn-only"

export interface BudgetLimits {
  sessionMaxUsd: number
  warnAt: number
}

export interface BudgetResolved {
  limits: BudgetLimits
  action: BudgetAction
}

export interface BudgetEvaluation {
  level: BudgetLevel
  /** Present for warn and exceeded levels; states spent and limit. */
  message: string | undefined
}

export type BudgetConfig = ConfigV1.Info["budget"]

const DEFAULT_WARN_AT = 0.8

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatUsd(value: number): string {
  return usd.format(value)
}

/** Invalid or missing warnAt values fall back to the default instead of failing config load. */
export function normalizeWarnAt(warnAt: number | undefined): number {
  if (warnAt === undefined || !Number.isFinite(warnAt) || warnAt <= 0 || warnAt > 1) return DEFAULT_WARN_AT
  return warnAt
}

/**
 * Resolves the enforceable budget from config. Returns undefined when the guard
 * is disabled: no config, no limit, or a nonsensical limit (zero/negative/
 * non-finite) must never block a session.
 */
export function resolve(budget: BudgetConfig | undefined): BudgetResolved | undefined {
  const sessionMaxUsd = budget?.sessionMaxUsd
  if (sessionMaxUsd === undefined || !Number.isFinite(sessionMaxUsd) || sessionMaxUsd <= 0) return undefined
  return {
    limits: { sessionMaxUsd, warnAt: normalizeWarnAt(budget?.warnAt) },
    action: budget?.action === "warn-only" ? "warn-only" : "stop",
  }
}

/**
 * Evaluates spent against the limit. Boundary semantics: spent exactly at the
 * limit is exceeded; spent exactly at limit * warnAt is warn. Exceeded wins
 * over warn. Non-positive or non-finite spent is ok.
 */
export function evaluate(input: { spent: number; limit: number; warnAt: number }): BudgetEvaluation {
  const { spent, limit, warnAt } = input
  if (!Number.isFinite(spent) || spent <= 0) return { level: "ok", message: undefined }
  if (spent >= limit) return { level: "exceeded", message: formatExceeded(spent, limit) }
  if (spent >= limit * warnAt) return { level: "warn", message: formatWarn(spent, limit, warnAt) }
  return { level: "ok", message: undefined }
}

function formatExceeded(spent: number, limit: number): string {
  return `Session cost budget exceeded: spent ${formatUsd(spent)} of the ${formatUsd(limit)} limit.`
}

function formatWarn(spent: number, limit: number, warnAt: number): string {
  const percent = Math.round(warnAt * 100)
  return `Session cost at ${formatUsd(spent)} of the ${formatUsd(limit)} budget (${percent}% warn threshold).`
}

// Warn/exceeded notices fire once per session and level. Session IDs are unique,
// so a process-lifetime latch is enough; clearNotices exists for tests.
const noticed = new Map<string, Set<BudgetLevel>>()

export function firstNotice(sessionID: string, level: BudgetLevel): boolean {
  let levels = noticed.get(sessionID)
  if (!levels) {
    levels = new Set()
    noticed.set(sessionID, levels)
  }
  if (levels.has(level)) return false
  levels.add(level)
  return true
}

export function clearNotices(sessionID?: string): void {
  if (sessionID === undefined) {
    noticed.clear()
    return
  }
  noticed.delete(sessionID)
}
