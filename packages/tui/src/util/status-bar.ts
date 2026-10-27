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

export function branchLabel(branch: string | undefined): string | undefined {
  const value = branch?.trim()
  return value || undefined
}
