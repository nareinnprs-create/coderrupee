import type { CommandUsageMap, CommandUsageStat } from "@/context/command"

// A command's score decays with a ~3-day half-life, so recent use dominates
// while stale history never fully pins a command to the top.
const RECENCY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000

export function commandFrecencyScore(stat: CommandUsageStat | undefined, now: number): number {
  if (!stat || stat.count <= 0) return 0
  const age = Math.max(0, now - stat.lastUsedAt)
  return stat.count * Math.pow(0.5, age / RECENCY_HALF_LIFE_MS)
}

// Stable sort: commands with equal or zero scores keep their registration
// order, so a palette without usage history renders exactly as before.
export function rankCommandPaletteCommands<T extends { id: string }>(items: T[], usage: CommandUsageMap, now: number): T[] {
  return items
    .map((item) => ({ item, score: commandFrecencyScore(usage[item.id], now) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}
