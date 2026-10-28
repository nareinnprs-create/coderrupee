// Flag-gated performance records for the hot UI paths (timeline render batches,
// markdown parse/flush cycle, review pane diff loads). Enabled with
// CODERRUPEE_PERF=1; without the flag every helper returns immediately and call
// sites guard on PERF.enabled so the off path stays allocation-free. Records
// never leave the process: they surface through perfSummary(), perfTable(),
// and the globalThis.__crPerf dump when the flag is on.
//
// MEASUREMENTS (item 13 gate, 2026-10-28, worker box, bun 1.3.14; harness
// packages/app/e2e/performance/unit/item13-pure-perf.test.ts run against base
// 2429663c0e and this branch with an identical fixture: 2080-part session ->
// 2079 timeline rows, 159-delta markdown stream, 300-key worker burst, 500-file
// review diff; the flag was unset during timing so instrumentation adds no
// overhead to these numbers; base reruns back-to-back bound run-to-run noise):
//
//   metric                                         base           branch
//   timeline.projection p50 (2080 parts)           18.8-22.6 ms   17.4 ms   (code path unchanged)
//   virtualizer estimate error (total size)        62.77%         0.00%
//   bottom-window first-measure correction         4828 px        0 px
//   stale-reasoning restore size drift             23360 px       0 px
//   stale-reasoning restore start misalignment     23360 px       0 px
//   markdown flush p50 (159 deltas)                529-711 ms     556 ms    (code path unchanged)
//   worker burst queue depth peak (300 keys)       300 unbounded  64 gated  (236 dropped-oldest, newest survives)
//   review diff normalize p50 (500 files)          0.39-0.44 ms   0.41 ms   (code path unchanged)
//
// Estimate/restore rows compare against representative per-tag rendered
// heights; per-row variance remains at runtime — what is eliminated is the
// systematic per-tag bias of the flat 60px estimate and of expanded-height
// reasoning snapshots.

const RING_CAP = 512

const durations = new Map<string, number[]>()
const counters = new Map<string, number>()
const gauges = new Map<string, number>()

function environmentEnabled() {
  return globalThis.process?.env?.CODERRUPEE_PERF === "1"
}

// Mutable so tests can toggle instrumentation without reload tricks.
export const PERF = { enabled: environmentEnabled() }

export function perfSample(name: string, durationMs: number) {
  if (!PERF.enabled) return
  let list = durations.get(name)
  if (!list) {
    list = []
    durations.set(name, list)
  }
  if (list.length >= RING_CAP) list.shift()
  list.push(durationMs)
}

export function perfCount(name: string, value = 1) {
  if (!PERF.enabled) return
  counters.set(name, (counters.get(name) ?? 0) + value)
}

// Keeps the observed maximum (queue depth peak, in-flight peak, ...).
export function perfGauge(name: string, value: number) {
  if (!PERF.enabled) return
  if (value > (gauges.get(name) ?? Number.NEGATIVE_INFINITY)) gauges.set(name, value)
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))] ?? 0
}

export type PerfMarkSummary = { count: number; p50: number; p95: number }

export function perfSummary() {
  if (!PERF.enabled) return { marks: {}, counters: {}, gauges: {} }
  const marks: Record<string, PerfMarkSummary> = {}
  for (const [name, list] of durations) {
    const sorted = [...list].sort((a, b) => a - b)
    marks[name] = { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
  }
  return {
    marks,
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
  }
}

export function perfDump() {
  const summary = perfSummary()
  ;(globalThis as Record<string, unknown>).__crPerf = { at: new Date().toISOString(), ...summary }
  return summary
}

export function perfTable() {
  const summary = perfSummary()
  console.table(summary.marks)
  console.table({ ...summary.gauges, ...summary.counters })
  return summary
}

export function perfReset() {
  durations.clear()
  counters.clear()
  gauges.clear()
}

if (PERF.enabled) {
  ;(globalThis as Record<string, unknown>).__crPerf = {
    summary: perfSummary,
    dump: perfDump,
    table: perfTable,
    reset: perfReset,
  }
}
