import { beforeAll, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@coderrupee/sdk/v2"
import { normalize } from "@coderrupee/session-ui/session-diff"
import { project, stream } from "@coderrupee/session-ui/markdown-stream"
import { createLatestWorkerQueue } from "../../../../session-ui/src/components/markdown-worker-queue"
import { createWorkerTransport } from "../../../../session-ui/src/components/markdown-worker-transport"

// Item 13 (M4) synthetic measurement harness: 2000-part session + 500-file diff.
// Pure-logic timings only, no DOM. The same file runs against the base commit and
// the m4/perf branch; branch-only modules load through optionalImport() so the
// file stays byte-identical on both sides. Timings are machine-dependent; the
// gate consumes before/after deltas from the SAME machine, not absolute values.

const RUNS = Number(process.env.ITEM13_RUNS ?? 40)
const WARMUPS = Number(process.env.ITEM13_WARMUPS ?? 3)
const PARTS = Number(process.env.ITEM13_PARTS ?? 2000)
const DIFF_FILES = Number(process.env.ITEM13_DIFF_FILES ?? 500)
const DELTAS = Number(process.env.ITEM13_DELTAS ?? 160)
const QUEUE_KEYS = Number(process.env.ITEM13_QUEUE_KEYS ?? 300)
const VIEWPORT = 900

let seed = 0x1f2e3d4c
function rnd() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"]
function lorem(length: number) {
  let out = ""
  while (out.length < length) {
    out += (out ? " " : "") + words[Math.floor(rnd() * words.length)]
    if (rnd() < 0.12) out += ".\n\n"
  }
  return out.slice(0, length)
}

type LoosePart = Record<string, unknown> & { id: string; type: string; text?: string }

function textPart(index: number, length: number): LoosePart {
  const prose = lorem(length)
  const text =
    index % 8 === 0
      ? `${prose}\n\n\`\`\`ts\nexport const value${index} = "${lorem(120)}"\n\`\`\``
      : `${prose}\n\nInline note \`value_${index}\` here.`
  return { id: `prt_t_${index}`, type: "text", text }
}

function reasoningPart(index: number, length: number): LoosePart {
  return {
    id: `prt_r_${index}`,
    type: "reasoning",
    text: lorem(length),
    time: { start: 1700000000000 + index, end: 1700000000000 + index + 400 },
  }
}

function toolPart(index: number, tool: string, outputLength: number): LoosePart {
  return {
    id: `prt_tool_${tool}_${index}`,
    type: "tool",
    callID: `call_${index}`,
    tool,
    state: {
      status: "completed",
      input: { filePath: `src/generated/file-${index}.ts` },
      output: lorem(outputLength),
      title: `file-${index}.ts`,
      metadata: {},
      time: { start: 1700000000000 + index, end: 1700000000000 + index + 300 },
    },
  }
}

// Builds a session with roughly `targetParts` parts across mixed text/reasoning/tool turns.
function buildSession(targetParts: number) {
  const partsPerTurn = 5 // user text + ~4 assistant parts per turn on average
  const turns = Math.ceil(targetParts / partsPerTurn)
  const messages: Array<UserMessage | AssistantMessage> = []
  const sessionMessages = []
  const partsByMessage = new Map<string, Part[]>()
  for (let index = 0; index < turns; index++) {
    const userID = `msg_user_${index}`
    const assistantID = `msg_assistant_${index}`
    sessionMessages.push({ id: userID, type: "message" }, { id: assistantID, type: "message" })
    const user = {
      id: userID,
      sessionID: "ses_perf",
      role: "user",
      time: { created: 1700000000000 + index * 10_000 },
      agent: "build",
    } as unknown as UserMessage
    const assistantParts = [
      ...(index % 5 === 0 ? [reasoningPart(index, 420) as Part] : []),
      toolPart(index, "read", 220) as Part,
      toolPart(index, "grep", 180) as Part,
      toolPart(index, index % 4 === 0 ? "edit" : "bash", 620) as Part,
      textPart(index, 160 + (index % 6) * 90) as Part,
    ]
    const assistant = {
      id: assistantID,
      sessionID: "ses_perf",
      role: "assistant",
      parentID: userID,
      time: { created: 1700000000000 + index * 10_000 + 1_000, completed: 1700000000000 + index * 10_000 + 8_000 },
      modelID: "claude-opus-4-6",
      providerID: "coderrupee",
      mode: "build",
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    } as unknown as AssistantMessage
    messages.push(user, assistant)
    partsByMessage.set(userID, [textPart(index, 100) as Part])
    partsByMessage.set(assistantID, assistantParts)
  }
  const partCount = [...partsByMessage.values()].reduce((sum, list) => sum + list.length, 0)
  return { messages, sessionMessages, parts: (id: string) => partsByMessage.get(id) ?? [], partCount }
}

function buildReviewDiffs(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const lines = index % 3 === 0 ? 300 : index % 3 === 1 ? 120 : 38
    const file = `src/review/generated-${String(index).padStart(3, "0")}.ts`
    const body = Array.from({ length: lines }, (_, line) => `export const value_${index}_${line} = "${lorem(42)}"`)
    const changed = body
      .slice()
      .map((line, at) => (at % 40 === 0 ? `export const updated_${index}_${at} = "${lorem(42)}"` : line))
    const patch = [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      `@@ -1,${lines} +1,${lines} @@`,
      ...body.flatMap((line, at) => (line === changed[at] ? [` ${line}`] : [`-${line}`, `+${changed[at]}`])),
    ].join("\n")
    return { file, patch, additions: 3, deletions: 3, status: "modified" as const }
  })
}

function buildStreamingText(blocks: number) {
  let text = ""
  for (let index = 0; index < blocks; index++) {
    text += `${lorem(300)}\n\n`
    if (index % 4 === 0) text += `\`\`\`ts\nexport const block${index} = "${lorem(80)}"\n\`\`\`\n\n`
  }
  return text
}

type Stats = { p50: number; p95: number; mean: number; n: number }
function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0
  const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
  return { p50: pick(0.5), p95: pick(0.95), mean, n: sorted.length }
}

function fmtRow(name: string, value: Stats | number, unit = "ms") {
  if (typeof value === "number") return `${name.padEnd(46)} ${value.toFixed(2).padStart(10)} ${unit}`
  return `${name.padEnd(46)} ${value.p50.toFixed(3).padStart(10)} ${value.p95.toFixed(3).padStart(10)} ${value.mean.toFixed(3).padStart(10)}`
}

async function optionalImport(path: string) {
  try {
    return (await import(path)) as Record<string, unknown> | undefined
  } catch {
    return undefined
  }
}

beforeAll(() => {
  // The product markdown module graph contains a Vite-only `?worker&url` import;
  // shim it so the projection chain loads under plain bun.
  Bun.plugin({
    name: "item13-worker-url-shim",
    setup(build) {
      build.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: "item13-shim" }))
      build.onLoad({ filter: /.*/, namespace: "item13-shim" }, () => ({
        contents: `export default "item13-shimmed-worker-url"`,
        loader: "js",
      }))
    },
  })
})

test(
  "item 13 pure perf harness (2000-part session, 500-file diff)",
  async () => {
  // Branch-only modules: present on m4/perf, absent on base.
  const virtualItems = await optionalImport("../../../src/pages/session/timeline/virtual-items")
  const estimateRowSize = virtualItems?.estimateRowSize as
    | ((row: { _tag: string }) => number | undefined)
    | undefined
  const pruneMeasurements = virtualItems?.normalizeThinkingMeasurements as
    | (<T extends { index: number; key: unknown; start: number; size: number }>(items: T[]) => T[])
    | undefined
  const backpressure = await optionalImport("@coderrupee/session-ui/markdown-parse-backpressure")
  const createParseGate = backpressure?.createMarkdownParseGate as
    | ((input: {
        maxInFlight: number
        maxLagFrames: number
        frames: () => number
        onDrop: (ticket: { id: number }) => void
      }) => {
        acquire: () => { id: number }
        release: (ticket: { id: number }) => void
        pending: () => number
        dropped: () => number
      })
    | undefined

  const lines: string[] = []
  const summary: Record<string, number> = {}
  const emit = (line: string) => lines.push(line)

  // --- A. Timeline projection over the synthetic session --------------------
  const session = buildSession(PARTS)
  // The projection chain pulls the client Solid build; without the `solid`
  // condition Kobalte throws at module load, so bail with a skip marker.
  const rowsModule = await import("../../../src/pages/session/timeline/rows").catch(() => undefined)
  if (!rowsModule) {
    console.log("ITEM13 SKIP: run with `bun test --conditions=solid` (client Solid build required)")
    return
  }
  const Timeline = rowsModule.Timeline as {
    constructSessionMessageRows: (...args: never[]) => { rows: Array<{ _tag: string }> }
  }
  const { constructSessionMessageRows } = Timeline
  const runProjection = () =>
    constructSessionMessageRows(
      session.sessionMessages as never[],
      (id: string) => session.messages.find((message) => message.id === id),
      session.parts,
      false,
      "idle",
      true,
      [],
    )
  for (let index = 0; index < WARMUPS; index++) runProjection()
  const projectionSamples: number[] = []
  let rows: ReturnType<typeof runProjection>["rows"] = []
  for (let index = 0; index < RUNS; index++) {
    const start = performance.now()
    rows = runProjection().rows
    projectionSamples.push(performance.now() - start)
  }
  const projectionStats = stats(projectionSamples)
  emit(fmtRow(`A timeline.projection parts=${session.partCount} rows=${rows.length}`, projectionStats))
  summary.projection_p50_ms = projectionStats.p50
  summary.projection_p95_ms = projectionStats.p95
  summary.session_parts = session.partCount
  summary.session_rows = rows.length

  // --- E1. Virtualizer size estimates vs synthetic actual heights -----------
  // Actual per-row heights mirror typical rendered heights for the row tags.
  const timelineFallbackItemSize = 60
  const actualByTag: Record<string, number> = {
    TurnGap: 24,
    TurnDivider: 33,
    UserMessage: 88,
    CommentStrip: 48,
    Thinking: 28,
    AssistantPart: 240,
    DiffSummary: 64,
    Error: 60,
    Retry: 48,
  }
  const actualHeights = rows.map((row) => actualByTag[row._tag] ?? 60)
  const actualTotal = actualHeights.reduce((sum, size) => sum + size, 0)
  const tagEstimate = (row: { _tag: string }) => estimateRowSize?.(row) ?? timelineFallbackItemSize
  const estimatedHeights = rows.map(tagEstimate)
  const estimatedTotal = estimatedHeights.reduce((sum, size) => sum + size, 0)
  const totalErrorPct = (Math.abs(estimatedTotal - actualTotal) / actualTotal) * 100
  // Scroll correction churn: |estimate - actual| summed over the bottom window
  // (viewport + overscan) — this is what shouldAdjustScrollPositionOnItemSizeChange
  // and the bottom anchor absorb when fresh rows are measured for the first time.
  const windowStart = Math.max(0, rows.length - 40)
  const windowCorrection = actualHeights
    .slice(windowStart)
    .reduce((sum, size, index) => sum + Math.abs(estimatedHeights[windowStart + index] - size), 0)
  emit(
    fmtRow(
      `E1 est.totalSize err% (${estimateRowSize ? "tag" : "flat60"}) total=${(estimatedTotal / 1000).toFixed(0)}k/${(actualTotal / 1000).toFixed(0)}k`,
      totalErrorPct,
      "%",
    ),
  )
  emit(fmtRow("E1 bottom-window correction (40 rows)", windowCorrection, "px"))
  summary.estimate_variant = estimateRowSize ? 1 : 0
  summary.total_size_error_pct = totalErrorPct
  summary.bottom_window_correction_px = windowCorrection

  // --- E2. Prepend anchor drift (measurement-cache restores) ----------------
  // A stale snapshot holds expanded reasoning heights under stable row keys;
  // restored verbatim, since-collapsed rows start hundreds of px too tall.
  // Drift = Σ|restored size - actual|; misalignment = max restored-vs-actual
  // start offset error.
  const staleHeights = rows.map((row) => (row._tag === "Thinking" ? 320 : actualByTag[row._tag] ?? 60))
  const actualPrefix: number[] = []
  let prefix = 0
  for (const size of actualHeights) {
    actualPrefix.push(prefix)
    prefix += size
  }
  const stalePrefix: number[] = []
  let staleSum = 0
  for (const size of staleHeights) {
    stalePrefix.push(staleSum)
    staleSum += size
  }
  const staleSnapshot = rows.map((row, index) => ({
    index,
    key: row._tag === "Thinking" ? `thinking:perf:${index}` : `${row._tag}:perf:${index}`,
    start: stalePrefix[index],
    size: staleHeights[index],
  }))
  const restored = pruneMeasurements ? pruneMeasurements(staleSnapshot) : staleSnapshot
  let restoreDrift = 0
  let restoreMisalign = 0
  for (const item of restored) {
    restoreDrift += Math.abs(item.size - actualHeights[item.index])
    restoreMisalign = Math.max(restoreMisalign, Math.abs(item.start - actualPrefix[item.index]))
  }
  emit(
    fmtRow(
      `E2 stale-restore drift (${pruneMeasurements ? "normalized" : "raw"}) items=${restored.length}`,
      restoreDrift,
      "px",
    ),
  )
  emit(fmtRow("E2 stale-restore start misalignment", restoreMisalign, "px"))
  summary.stale_restore_drift_px = restoreDrift
  summary.stale_restore_misalign_px = restoreMisalign
  summary.stale_restore_items = restored.length

  // --- B. Markdown streaming project/flush cycle ----------------------------
  const finalText = buildStreamingText(96)
  const chunkSize = Math.ceil(finalText.length / DELTAS)
  const flushSamples: number[] = []
  let previous: ReturnType<typeof project> | undefined
  for (let index = chunkSize; index <= finalText.length; index += chunkSize) {
    const text = finalText.slice(0, index)
    const start = performance.now()
    previous = project(previous, text, true)
    flushSamples.push(performance.now() - start)
  }
  const flush = stats(flushSamples)
  emit(fmtRow(`B markdown.project/flush deltas=${flushSamples.length}`, flush))
  summary.markdown_flush_p50_ms = flush.p50
  summary.markdown_flush_p95_ms = flush.p95

  const streamSamples: number[] = []
  for (let index = 0; index < 20; index++) {
    const start = performance.now()
    stream(finalText, true)
    streamSamples.push(performance.now() - start)
  }
  const blockSplit = stats(streamSamples)
  emit(fmtRow("B markdown.stream block-split (96 blocks)", blockSplit))
  summary.markdown_stream_p50_ms = blockSplit.p50
  summary.markdown_stream_p95_ms = blockSplit.p95

  // --- C. Markdown worker pipeline queue depth (burst across keys) ----------
  // Mirrors markdown.worker.ts + markdown-worker.ts wiring with a fake worker:
  // N block-highlight requests arrive in one burst across N distinct keys.
  const superseded: number[] = []
  const worker = createLatestWorkerQueue<{ id: number; key: string }>({
    run: async () => {
      await Promise.resolve()
    },
    supersede: (request) => superseded.push(request.id),
    dispose: () => {},
  })
  const transport = createWorkerTransport<{ id: number; key: string }>({
    post: (request) => worker.highlight(request),
    supersede: (request) => superseded.push(request.id),
  })
  let depthPeak = 0
  let id = 0
  for (let index = 0; index < QUEUE_KEYS; index++) {
    transport.send({ id: ++id, key: `block-${index}` })
    depthPeak = Math.max(depthPeak, transport.queued() + worker.pending())
  }
  await worker.idle()
  emit(fmtRow(`C pipeline queue depth peak (${QUEUE_KEYS} keys)`, depthPeak, "reqs"))
  emit(fmtRow("C pipeline superseded", superseded.length, "reqs"))
  summary.queue_depth_peak = depthPeak
  summary.queue_superseded = superseded.length

  // Branch-only: bounded parse gate under the same burst.
  if (createParseGate) {
    let frame = 0
    const dropped: number[] = []
    const gate = createParseGate({ maxInFlight: 64, maxLagFrames: 60, frames: () => frame, onDrop: (ticket) => dropped.push(ticket.id) })
    let gatePeak = 0
    for (let index = 0; index < QUEUE_KEYS; index++) gate.acquire()
    gatePeak = gate.pending()
    frame = 1
    emit(fmtRow("C gate in-flight peak (bounded)", gatePeak, "reqs"))
    emit(fmtRow("C gate dropped (backpressure)", gate.dropped(), "reqs"))
    summary.gate_inflight_peak = gatePeak
    summary.gate_dropped = gate.dropped()
  }

  // --- D. Review diff load: 500-file normalize ------------------------------
  const diffs = buildReviewDiffs(DIFF_FILES)
  for (let index = 0; index < WARMUPS; index++) normalize(diffs[0])
  const diffSamples: number[] = []
  for (const diff of diffs) {
    const start = performance.now()
    normalize(diff)
    diffSamples.push(performance.now() - start)
  }
  const diffStats = stats(diffSamples)
  const diffTotal = diffSamples.reduce((sum, value) => sum + value, 0)
  emit(fmtRow(`D review diff normalize files=${DIFF_FILES}`, diffStats))
  emit(fmtRow("D review diff normalize total", diffTotal))
  summary.review_diff_p50_ms = diffStats.p50
  summary.review_diff_p95_ms = diffStats.p95
  summary.review_diff_total_ms = diffTotal

  // Completion + collection assertions only (no machine-dependent thresholds).
  expect(rows.length).toBeGreaterThan(200)
  expect(session.partCount).toBeGreaterThanOrEqual(PARTS)
  expect(diffs.length).toBe(DIFF_FILES)
  expect(flushSamples.length).toBeGreaterThan(100)
  expect(depthPeak).toBeGreaterThan(0)
  if (createParseGate) expect(summary.gate_inflight_peak).toBeLessThanOrEqual(64)

  console.log(`\nITEM13 PURE PERF (${estimateRowSize ? "AFTER/branch" : "BEFORE/base"})`)
  for (const line of lines) console.log(line)
  console.log("ITEM13_JSON " + JSON.stringify(summary))
  },
  300_000,
)
