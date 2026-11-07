import { describe, expect, test } from "bun:test"
import type { Message, Part, ToolPart } from "@coderrupee/sdk/v2"
import {
  agentActions,
  buildAgentTree,
  collectTaskSeeds,
  flattenAgentRows,
  type AgentTaskSeed,
} from "./agent-tree"

const toolPart = (callID: string, state: ToolPart["state"], childID?: string): ToolPart => {
  const part: ToolPart = {
    id: `part-${callID}`,
    sessionID: "s-parent",
    messageID: "m1",
    type: "tool",
    callID,
    tool: "task",
    state,
  }
  if (childID) {
    ;(part.state as { metadata?: Record<string, unknown> }).metadata = { sessionId: childID }
  }
  return part
}

const otherPart = (id: string): Part => ({
  id,
  sessionID: "s-parent",
  messageID: "m1",
  type: "text",
  text: "hello",
})

const message = (id: string, parts: Part[]): Message =>
  ({
    id,
    sessionID: "s-parent",
    role: "user",
    parts,
  }) as unknown as Message

const partsIndex = (parts: Part[]) => {
  const byMessage = new Map<string, Part[]>()
  for (const part of parts) {
    const list = byMessage.get(part.messageID) ?? []
    list.push(part)
    byMessage.set(part.messageID, list)
  }
  return (messageID: string) => byMessage.get(messageID)
}

const seed = (overrides: Partial<AgentTaskSeed>): AgentTaskSeed => ({
  callID: "call-1",
  status: "running",
  startedAt: 1000,
  sessionID: "s-child",
  ...overrides,
})

describe("collectTaskSeeds", () => {
  test("returns empty for no messages, empty messages, and missing parts", () => {
    expect(collectTaskSeeds(undefined, () => undefined)).toEqual([])
    expect(collectTaskSeeds([], () => undefined)).toEqual([])
    expect(collectTaskSeeds([message("m1", [])], () => undefined)).toEqual([])
    expect(collectTaskSeeds([message("m1", [otherPart("p1")])], partsIndex([otherPart("p1")]))).toEqual([])
  })

  test("extracts child id, agent type, description, and timing from running task parts", () => {
    const part = toolPart(
      "call-a",
      { status: "running", input: { subagent_type: "explore", description: "Find usages" }, time: { start: 100 } },
      "s-child",
    )
    const seeds = collectTaskSeeds([message("m1", [part])], partsIndex([part]))
    expect(seeds).toEqual([
      {
        callID: "call-a",
        sessionID: "s-child",
        agentType: "explore",
        description: "Find usages",
        status: "running",
        startedAt: 100,
      },
    ])
  })

  test("captures completed timing, error text, and skips non-task tools", () => {
    const completed = toolPart(
      "call-b",
      {
        status: "completed",
        input: {},
        output: "done",
        title: "Explore",
        metadata: { sessionId: "s-done" },
        time: { start: 10, end: 250 },
      },
      "s-done",
    )
    const failed = toolPart(
      "call-c",
      { status: "error", input: {}, error: "boom", time: { start: 20, end: 30 } },
      "s-fail",
    )
    const bash = {
      id: "p-bash",
      sessionID: "s-parent",
      messageID: "m1",
      type: "tool",
      callID: "call-z",
      tool: "bash",
      state: { status: "running", input: { command: "ls" }, time: { start: 5 } },
    } as unknown as Part
    const parts = [completed, failed, bash]
    const seeds = collectTaskSeeds([message("m1", parts)], partsIndex(parts))
    expect(seeds).toEqual([
      { callID: "call-b", sessionID: "s-done", status: "completed", startedAt: 10, endedAt: 250 },
      { callID: "call-c", sessionID: "s-fail", status: "error", startedAt: 20, endedAt: 30, error: "boom" },
    ])
  })

  test("pending seeds carry only call id and status", () => {
    const part = toolPart("call-p", { status: "pending", input: {}, raw: "" })
    const seeds = collectTaskSeeds([message("m1", [part])], partsIndex([part]))
    expect(seeds).toEqual([{ callID: "call-p", status: "pending" }])
  })

  test("ignores child ids that are not non-empty strings", () => {
    const part = toolPart("call-x", { status: "running", input: {}, time: { start: 1 } })
    ;(part.state as { metadata?: Record<string, unknown> }).metadata = { sessionId: 42 }
    const seeds = collectTaskSeeds([message("m1", [part])], partsIndex([part]))
    expect(seeds[0]?.sessionID).toBeUndefined()
  })
})

describe("buildAgentTree", () => {
  test("empty input yields an empty tree with zeroed stats", () => {
    const tree = buildAgentTree({ seeds: [] }, 0)
    expect(tree).toEqual({
      nodes: [],
      stats: { total: 0, running: 0, completed: 0, failed: 0, totalCost: 0 },
    })
  })

  test("completed agent carries child snapshot data and fixed duration", () => {
    const tree = buildAgentTree(
      {
        seeds: [seed({ status: "completed", startedAt: 100, endedAt: 350 })],
        children: { "s-child": { title: "Explore code", cost: 0.5, model: "acme/fast" } },
      },
      9999,
    )
    expect(tree.nodes).toHaveLength(1)
    const node = tree.nodes[0]!
    expect(node.status).toBe("completed")
    expect(node.title).toBe("Explore code")
    expect(node.childTitle).toBe("Explore code")
    expect(node.cost).toBe(0.5)
    expect(node.model).toBe("acme/fast")
    expect(node.durationMs).toBe(250)
    expect(tree.stats.totalCost).toBe(0.5)
  })

  test("description wins over child title and agent type in the row title", () => {
    const tree = buildAgentTree(
      {
        seeds: [seed({ description: "Find usages", agentType: "explore" })],
        children: { "s-child": { title: "Session title" } },
      },
      100,
    )
    expect(tree.nodes[0]?.title).toBe("Find usages")
  })

  test("running duration uses now and feeds longest-running stats", () => {
    const tree = buildAgentTree({ seeds: [seed({ startedAt: 1000 })] }, 4500)
    const node = tree.nodes[0]!
    expect(node.status).toBe("running")
    expect(node.durationMs).toBe(3500)
    expect(tree.stats.running).toBe(1)
    expect(tree.stats.longestRunningMs).toBe(3500)
    expect(tree.stats.longestRunningCallID).toBe("call-1")
  })

  test("queued agents have no duration and stay out of running stats", () => {
    const tree = buildAgentTree({ seeds: [seed({ status: "pending", startedAt: undefined, sessionID: undefined })] }, 100)
    const node = tree.nodes[0]!
    expect(node.status).toBe("queued")
    expect(node.sessionID).toBeUndefined()
    expect(node.durationMs).toBeUndefined()
    expect(tree.stats.running).toBe(0)
    expect(tree.stats.total).toBe(1)
  })

  test("failed agents count and surface the error text", () => {
    const tree = buildAgentTree({ seeds: [seed({ status: "error", startedAt: 10, endedAt: 40, error: "boom" })] }, 100)
    expect(tree.nodes[0]?.error).toBe("boom")
    expect(tree.stats.failed).toBe(1)
    expect(tree.stats.completed).toBe(0)
  })

  test("missing child sessions still render from the task part alone", () => {
    const tree = buildAgentTree({ seeds: [seed({})] }, 100)
    const node = tree.nodes[0]!
    expect(node.sessionID).toBe("s-child")
    expect(node.cost).toBeUndefined()
    expect(node.childTitle).toBeUndefined()
    expect(node.model).toBeUndefined()
    expect(node.children).toEqual([])
    expect(tree.stats.totalCost).toBe(0)
  })

  test("negative or missing timing never produces a duration", () => {
    const inverted = buildAgentTree({ seeds: [seed({ status: "completed", startedAt: 500, endedAt: 100 })] }, 100)
    expect(inverted.nodes[0]?.durationMs).toBeUndefined()
    const partial = buildAgentTree({ seeds: [seed({ status: "completed", startedAt: 500 })] }, 100)
    expect(partial.nodes[0]?.durationMs).toBeUndefined()
    const future = buildAgentTree({ seeds: [seed({ startedAt: 5000 })] }, 100)
    expect(future.nodes[0]?.durationMs).toBe(0)
  })

  test("nested tasks expand to depth two and drop depth three", () => {
    const tree = buildAgentTree(
      {
        seeds: [seed({ sessionID: "s-a" })],
        children: {
          "s-a": {
            title: "A",
            tasks: [seed({ callID: "call-b", sessionID: "s-b" })],
          },
          "s-b": {
            title: "B",
            tasks: [seed({ callID: "call-c", sessionID: "s-c" })],
          },
          "s-c": {
            title: "C",
            tasks: [seed({ callID: "call-d", sessionID: "s-d" })],
          },
        },
      },
      100,
    )
    const rows = flattenAgentRows(tree.nodes)
    // call-1 (level 1) expands, call-b (level 2) renders but does not expand
    // further, so call-c (level 3) never enters the tree.
    expect(rows.map((row) => row.node.callID)).toEqual(["call-1", "call-b"])
    expect(rows.map((row) => row.depth)).toEqual([0, 1])
    expect(tree.stats.total).toBe(2)
  })

  test("cycles between child sessions terminate without duplicates", () => {
    const tree = buildAgentTree(
      {
        rootSessionID: "s-root",
        seeds: [seed({ sessionID: "s-a" })],
        children: {
          "s-a": { title: "A", tasks: [seed({ callID: "call-b", sessionID: "s-b" })] },
          "s-b": { title: "B", tasks: [seed({ callID: "call-back", sessionID: "s-a" })] },
        },
      },
      100,
    )
    expect(flattenAgentRows(tree.nodes).map((row) => row.node.callID)).toEqual(["call-1", "call-b"])
    expect(tree.stats.total).toBe(2)
  })

  test("a child pointing back at the root session is not expanded", () => {
    const tree = buildAgentTree(
      {
        rootSessionID: "s-root",
        seeds: [seed({ sessionID: "s-a" })],
        children: {
          "s-a": { title: "A", tasks: [seed({ callID: "call-root", sessionID: "s-root" })] },
          "s-root": { title: "Root", tasks: [seed({ callID: "call-again", sessionID: "s-a" })] },
        },
      },
      100,
    )
    const rows = flattenAgentRows(tree.nodes)
    // call-root renders as a level-two row (s-root is in the path, so it is
    // not expanded), and the root's own task list is never walked.
    expect(rows.map((row) => row.node.callID)).toEqual(["call-1", "call-root"])
    expect(tree.stats.total).toBe(2)
  })

  test("shared descendants reached through siblings are kept", () => {
    const tree = buildAgentTree(
      {
        seeds: [seed({ callID: "call-1", sessionID: "s-a" }), seed({ callID: "call-2", sessionID: "s-b" })],
        children: {
          "s-a": { title: "A", tasks: [seed({ callID: "call-shared", sessionID: "s-s" })] },
          "s-b": { title: "B", tasks: [seed({ callID: "call-shared", sessionID: "s-s" })] },
          "s-s": { title: "S" },
        },
      },
      100,
    )
    expect(flattenAgentRows(tree.nodes).map((row) => row.node.callID)).toEqual([
      "call-1",
      "call-shared",
      "call-2",
      "call-shared",
    ])
  })

  test("stats aggregate across nested levels including costs", () => {
    const tree = buildAgentTree(
      {
        seeds: [
          seed({ callID: "call-1", sessionID: "s-a", status: "completed", startedAt: 0, endedAt: 10 }),
          seed({ callID: "call-2", sessionID: "s-b", startedAt: 5000 }),
          seed({ callID: "call-3", status: "error", sessionID: "s-c", startedAt: 0, endedAt: 5 }),
        ],
        children: {
          "s-a": { title: "A", cost: 0.25, tasks: [seed({ callID: "call-nested", sessionID: "s-n" })] },
          "s-n": { title: "N", cost: 0.75 },
          "s-b": { title: "B", cost: 1.5 },
          "s-c": undefined,
        },
      },
      9000,
    )
    expect(tree.stats).toEqual({
      total: 4,
      running: 2,
      completed: 1,
      failed: 1,
      totalCost: 2.5,
      longestRunningMs: 8000,
      longestRunningCallID: "call-nested",
    })
  })
})

describe("agentActions", () => {
  test("cancel only for running agents with a child session and a host abort hook", () => {
    expect(agentActions({ status: "running", sessionID: "s-child" }, { canAbort: true, canNavigate: true })).toEqual({
      cancel: true,
      open: true,
      retry: false,
    })
    expect(agentActions({ status: "running", sessionID: "s-child" }, { canAbort: true })).toEqual({
      cancel: true,
      open: false,
      retry: false,
    })
    expect(agentActions({ status: "running" }, { canAbort: true })).toMatchObject({ cancel: false, open: false })
  })

  test("completed, failed, and queued agents never offer cancel", () => {
    for (const status of ["completed", "failed", "queued"] as const) {
      expect(agentActions({ status, sessionID: "s-child" }, { canAbort: true }).cancel).toBe(false)
    }
  })

  test("open requires a child session id and a navigation hook", () => {
    expect(agentActions({ status: "completed" }, { canNavigate: true }).open).toBe(false)
    expect(agentActions({ status: "completed", sessionID: "s-child" }, { canNavigate: true }).open).toBe(true)
    expect(agentActions({ status: "completed", sessionID: "s-child" }, {}).open).toBe(false)
  })

  test("retry is never available", () => {
    expect(agentActions({ status: "failed", sessionID: "s-child" }, { canAbort: true, canNavigate: true }).retry).toBe(
      false,
    )
  })
})

describe("flattenAgentRows", () => {
  test("prefers depth-first order with depth counters", () => {
    const tree = buildAgentTree(
      {
        seeds: [seed({ callID: "call-1", sessionID: "s-a" }), seed({ callID: "call-2", sessionID: undefined })],
        children: {
          "s-a": { title: "A", tasks: [seed({ callID: "call-1b", sessionID: "s-b" })] },
          "s-b": { title: "B" },
        },
      },
      100,
    )
    expect(flattenAgentRows(tree.nodes).map((row) => [row.node.callID, row.depth])).toEqual([
      ["call-1", 0],
      ["call-1b", 1],
      ["call-2", 0],
    ])
  })

  test("returns empty for an empty tree", () => {
    expect(flattenAgentRows([])).toEqual([])
  })
})
