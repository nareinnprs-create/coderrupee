// Flag-gated performance records for the hot UI paths (timeline render batches,
// markdown parse/flush cycle, review pane diff loads). Enabled with
// CODERRUPEE_PERF=1; without the flag every helper returns immediately and call
// sites guard on PERF.enabled so the off path stays allocation-free. Records
// never leave the process: they surface through perfSummary(), perfTable(),
// and the globalThis.__crPerf dump when the flag is on.

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
