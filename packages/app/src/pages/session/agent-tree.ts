import type { Message, Part, ToolState } from "@coderrupee/sdk/v2"

// Pure model for the agent dashboard: task tool parts of a session become
// seeds, synced child snapshots turn them into a two-level agent tree with
// aggregated stats. No Solid or store access here so the tree math stays
// unit-testable in isolation.

export type AgentTaskSeed = {
  callID: string
  sessionID?: string
  agentType?: string
  description?: string
  status: ToolState["status"]
  startedAt?: number
  endedAt?: number
  error?: string
}

export type AgentChildSnapshot = {
  title?: string
  cost?: number
  model?: string
  status?: "idle" | "busy" | "retry"
  tasks?: AgentTaskSeed[]
}

export type AgentNodeStatus = "queued" | "running" | "completed" | "failed"

export type AgentNode = {
  callID: string
  status: AgentNodeStatus
  title: string
  children: AgentNode[]
  sessionID?: string
  agentType?: string
  childTitle?: string
  model?: string
  durationMs?: number
  cost?: number
  error?: string
}

export type AgentTreeStats = {
  total: number
  running: number
  completed: number
  failed: number
  totalCost: number
  longestRunningMs?: number
  longestRunningCallID?: string
}

export type AgentTree = {
  nodes: AgentNode[]
  stats: AgentTreeStats
}

export type AgentTreeInput = {
  seeds: AgentTaskSeed[]
  children?: Record<string, AgentChildSnapshot | undefined>
  rootSessionID?: string
}

// Task tool parts of one session, in message order. Mirrors the extraction the
// live task cards use (state metadata carries the child session id).
export const collectTaskSeeds = (
  messages: Message[] | undefined,
  partsOf: (messageID: string) => Part[] | undefined,
): AgentTaskSeed[] => {
  if (!messages?.length) return []
  const seeds: AgentTaskSeed[] = []
  for (const message of messages) {
    for (const part of partsOf(message.id) ?? []) {
      if (part.type !== "tool" || part.tool !== "task") continue
      const state = part.state
      const metadata = "metadata" in state ? state.metadata : undefined
      const input = state.input
      const seed: AgentTaskSeed = { callID: part.callID, status: state.status }
      const childID = metadata?.sessionId
      if (typeof childID === "string" && childID) seed.sessionID = childID
      if (typeof input.subagent_type === "string" && input.subagent_type) seed.agentType = input.subagent_type
      if (typeof input.description === "string" && input.description) seed.description = input.description
      if ("time" in state && typeof state.time.start === "number") seed.startedAt = state.time.start
      if ("time" in state && "end" in state.time && typeof state.time.end === "number") seed.endedAt = state.time.end
      if (state.status === "error") seed.error = state.error
      seeds.push(seed)
    }
  }
  return seeds
}

// Tree depth cap: agents of the session (depth 1) plus their own agents
// (depth 2). Deeper nesting is ignored.
const MAX_DEPTH = 2

export const buildAgentTree = (input: AgentTreeInput, now: number): AgentTree => {
  const path = new Set<string>()
  if (input.rootSessionID) path.add(input.rootSessionID)
  const nodes = buildAgentNodes(input.seeds, input.children ?? {}, path, 1, now)
  return { nodes, stats: summarizeTree(nodes) }
}

function buildAgentNodes(
  seeds: AgentTaskSeed[],
  children: Record<string, AgentChildSnapshot | undefined>,
  path: Set<string>,
  depth: number,
  now: number,
): AgentNode[] {
  const nodes: AgentNode[] = []
  for (const seed of seeds) {
    const childID = seed.sessionID
    const snapshot = childID ? children[childID] : undefined
    const status = agentNodeStatus(seed.status)
    const node: AgentNode = {
      callID: seed.callID,
      status,
      title: seed.description || snapshot?.title || seed.agentType || childID || seed.callID,
      children: [],
      durationMs: agentDurationMs(seed, status, now),
    }
    if (childID) node.sessionID = childID
    if (seed.agentType) node.agentType = seed.agentType
    if (snapshot?.title) node.childTitle = snapshot.title
    if (snapshot?.model) node.model = snapshot.model
    if (typeof snapshot?.cost === "number") node.cost = snapshot.cost
    if (seed.error) node.error = seed.error
    if (childID && depth < MAX_DEPTH && !path.has(childID)) {
      path.add(childID)
      node.children = buildAgentNodes(snapshot?.tasks ?? [], children, path, depth + 1, now)
      path.delete(childID)
    }
    nodes.push(node)
  }
  return nodes
}

const agentNodeStatus = (status: ToolState["status"]): AgentNodeStatus => {
  if (status === "pending") return "queued"
  if (status === "running") return "running"
  if (status === "error") return "failed"
  return "completed"
}

const agentDurationMs = (seed: AgentTaskSeed, status: AgentNodeStatus, now: number): number | undefined => {
  if (status === "completed" || status === "failed") {
    if (seed.startedAt === undefined || seed.endedAt === undefined) return undefined
    if (seed.endedAt < seed.startedAt) return undefined
    return seed.endedAt - seed.startedAt
  }
  if (status !== "running" || seed.startedAt === undefined) return undefined
  return Math.max(0, now - seed.startedAt)
}

const summarizeTree = (nodes: AgentNode[]): AgentTreeStats => {
  const stats: AgentTreeStats = { total: 0, running: 0, completed: 0, failed: 0, totalCost: 0 }
  const walk = (list: AgentNode[]) => {
    for (const node of list) {
      stats.total += 1
      if (node.status === "running") stats.running += 1
      if (node.status === "completed") stats.completed += 1
      if (node.status === "failed") stats.failed += 1
      if (node.cost !== undefined) stats.totalCost += node.cost
      if (
        node.status === "running" &&
        node.durationMs !== undefined &&
        node.durationMs > (stats.longestRunningMs ?? -1)
      ) {
        stats.longestRunningMs = node.durationMs
        stats.longestRunningCallID = node.callID
      }
      walk(node.children)
    }
  }
  walk(nodes)
  return stats
}

// Per-row action availability. Retry is always false: no server endpoint can
// re-invoke a finished task tool call, so the dashboard omits the control.
export type AgentActions = { cancel: boolean; open: boolean; retry: boolean }

export const agentActions = (
  node: Pick<AgentNode, "status" | "sessionID">,
  opts: { canAbort?: boolean; canNavigate?: boolean },
): AgentActions => ({
  cancel: node.status === "running" && node.sessionID !== undefined && !!opts.canAbort,
  open: node.sessionID !== undefined && !!opts.canNavigate,
  retry: false,
})

export type AgentRow = { node: AgentNode; depth: number }

export const flattenAgentRows = (nodes: AgentNode[]): AgentRow[] => {
  const rows: AgentRow[] = []
  const walk = (list: AgentNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth })
      walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
