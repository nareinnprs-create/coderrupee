import { SessionV1 } from "@coderrupee/core/v1/session"
import { Database } from "@coderrupee/core/database/database"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { CrossSpawnSpawner } from "@coderrupee/core/cross-spawn-spawner"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@coderrupee/core/provider"
import { ModelV2 } from "@coderrupee/core/model"
import { SessionProjector } from "@coderrupee/core/session/projector"
import { LLMEvent } from "@coderrupee/llm"
import { TuiEvent } from "@coderrupee/schema/tui-event"

// Model pricing: 1_000_000 USD per million input tokens => each prompt token
// costs exactly 1 USD, so mock usage token counts read as dollar amounts.
const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 1_000_000, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function testCfg(url: string, budget?: { sessionMaxUsd: number; warnAt?: number; action?: "stop" | "warn-only" }) {
  return {
    ...cfg,
    ...(budget ? { budget } : {}),
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  SessionStatus.node,
  CrossSpawnSpawner.node,
])
const replacements = [
  [SessionSummary.node, summary],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
] as const
const env = LayerNode.compile(
  LayerNode.group([root, LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })]),
  replacements,
)

const it = testEffect(env)

// Mock stream where the step that crosses the limit is not the last event, so a
// passing test proves the budget stop cuts the in-flight stream.
const budgetStopLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "hi" }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 12 } }),
        LLMEvent.textStart({ id: "text-2" }),
        LLMEvent.textDelta({ id: "text-2", text: "should not appear" }),
        LLMEvent.finish({ reason: "stop" }),
      ),
  }),
)
const budgetStopEnv = LayerNode.compile(root, [...replacements, [LLM.node, budgetStopLLM]])
const itBudgetStop = testEffect(budgetStopEnv)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  const events = yield* EventV2Bridge.Service
  return { processors, session, provider, events }
})

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const runStep = Effect.fn("test.runStep")(function* (input: {
  dir: string
  sessionID: SessionID
  text: string
}) {
  const { processors, session, provider } = yield* boot()
  const parent = yield* user(input.sessionID, "hi")
  const msg = yield* assistant(input.sessionID, parent.id, path.resolve(input.dir))
  const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
  const handle = yield* processors.create({
    assistantMessage: msg,
    sessionID: input.sessionID,
    model: mdl,
  })
  const result = yield* handle.process({
    user: {
      id: parent.id,
      sessionID: input.sessionID,
      role: "user",
      time: parent.time,
      agent: parent.agent,
      model: { providerID: ref.providerID, modelID: ref.modelID },
    } satisfies SessionV1.User,
    sessionID: input.sessionID,
    model: mdl,
    agent: agent(),
    system: [],
    messages: [{ role: "user", content: input.text }],
    tools: {},
  })
  const fresh = yield* session.get(input.sessionID)
  const parts = yield* MessageV2.parts(msg.id)
  return { result, error: handle.message.error, sessionCost: fresh.cost ?? 0, parts }
})

// Session cost is rolled up by the event projector; wait for the row to catch
// up before the next step reads it as its base cost.
const waitForCost = (sessionID: SessionID, expected: number) =>
  Effect.gen(function* () {
    const { session } = yield* boot()
    const stop = Date.now() + 5000
    while (Date.now() < stop) {
      const info = yield* session.get(sessionID)
      if ((info.cost ?? 0) === expected) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`session cost never reached ${expected}`))
  })

const collectEvents = Effect.fn("test.collectEvents")(function* (types: string[]) {
  const { events } = yield* boot()
  const seen: Array<{ type: string; data: Record<string, any> }> = []
  const off = yield* events.listen((evt) =>
    Effect.sync(() => {
      if (types.includes(evt.type)) seen.push({ type: evt.type, data: evt.data as Record<string, any> })
    }),
  )
  return { seen, off }
})

const budgetError = (error: SessionV1.Assistant["error"]) => {
  if (!error || error.name !== "UnknownError") return undefined
  return (error.data as { message: string }).message
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it.live("budget guard is disabled without config even at extreme spend", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* boot()
        yield* llm.text("hello", { usage: { input: 1000, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const run = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        expect(run.result).toBe("continue")
        expect(run.error).toBeUndefined()
        expect(run.sessionCost).toBe(1000)
      }),
    { config: (url) => testCfg(url) },
  ),
)

it.live("budget spend below the warn threshold keeps the run going", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("hello", { usage: { input: 2, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const { seen, off } = yield* collectEvents([TuiEvent.ToastShow.type, SessionV1.Event.Error.type])
        const run = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        yield* off
        expect(run.result).toBe("continue")
        expect(run.error).toBeUndefined()
        expect(seen).toHaveLength(0)
      }),
    { config: (url) => testCfg(url, { sessionMaxUsd: 10 }) },
  ),
)

it.live("budget warn at the threshold toasts once per session and does not stop", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("a", { usage: { input: 8, output: 0 } })
        yield* llm.text("b", { usage: { input: 1, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const { seen, off } = yield* collectEvents([TuiEvent.ToastShow.type, SessionV1.Event.Error.type])
        const first = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        expect(first.result).toBe("continue")
        expect(first.error).toBeUndefined()
        yield* waitForCost(chat.id, 8)
        // Second step: spent 9 stays in the warn band; the warn latch holds.
        const second = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        yield* off
        expect(second.result).toBe("continue")
        expect(second.error).toBeUndefined()
        expect(seen).toHaveLength(1)
        expect(seen[0].type).toBe(TuiEvent.ToastShow.type)
        expect(seen[0].data.variant).toBe("warning")
        expect(seen[0].data.message).toContain("$8.00")
        expect(seen[0].data.message).toContain("$10.00")
      }),
    { config: (url) => testCfg(url, { sessionMaxUsd: 10 }) },
  ),
)

itBudgetStop.live("budget exceeded with action stop aborts the in-flight stream", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { session, events } = yield* boot()
        const chat = yield* session.create({})
        const { seen, off } = yield* collectEvents([TuiEvent.ToastShow.type, SessionV1.Event.Error.type])
        const run = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        yield* off

        expect(run.result).toBe("stop")
        expect(budgetError(run.error)).toBe("Session cost budget exceeded: spent $12.00 of the $10.00 limit. Run stopped.")
        // The abort cut the stream: text emitted by the provider after the
        // step that crossed the limit never became a part.
        expect(run.parts.some((part) => part.type === "text" && part.text === "hi")).toBe(true)
        expect(run.parts.some((part) => part.type === "text" && part.text === "should not appear")).toBe(false)
        // The abort surfaces through the session error event, like the
        // interrupt path; no warning toast for the exceeded level.
        expect(seen).toHaveLength(1)
        expect(seen[0].type).toBe(SessionV1.Event.Error.type)
        expect((seen[0].data.error.data as { message: string }).message).toContain("Session cost budget exceeded")
      }),
    { config: testCfg("http://localhost:1/v1", { sessionMaxUsd: 10 }) },
  ),
)

it.live("budget exceeded accumulates across steps and stops the later step", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("a", { usage: { input: 6, output: 0 } })
        yield* llm.text("b", { usage: { input: 6, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const first = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        expect(first.result).toBe("continue")
        expect(first.error).toBeUndefined()
        expect(first.sessionCost).toBe(6)
        yield* waitForCost(chat.id, 6)
        const second = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        expect(second.result).toBe("stop")
        expect(budgetError(second.error)).toContain("spent $12.00 of the $10.00 limit")
      }),
    { config: (url) => testCfg(url, { sessionMaxUsd: 10 }) },
  ),
)

it.live("budget warn-only never stops, errors, or toasts", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("hello", { usage: { input: 12, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const { seen, off } = yield* collectEvents([TuiEvent.ToastShow.type, SessionV1.Event.Error.type])
        const run = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        yield* off
        expect(run.result).toBe("continue")
        expect(run.error).toBeUndefined()
        expect(run.sessionCost).toBe(12)
        expect(seen).toHaveLength(0)
      }),
    { config: (url) => testCfg(url, { sessionMaxUsd: 10, action: "warn-only" }) },
  ),
)

it.live("budget with an invalid limit never blocks the session", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* llm.text("hello", { usage: { input: 50, output: 0 } })
        const { session } = yield* boot()
        const chat = yield* session.create({})
        const run = yield* runStep({ dir, sessionID: chat.id, text: "hi" })
        expect(run.result).toBe("continue")
        expect(run.error).toBeUndefined()
      }),
    { config: (url) => testCfg(url, { sessionMaxUsd: 0, warnAt: 5 }) },
  ),
)
