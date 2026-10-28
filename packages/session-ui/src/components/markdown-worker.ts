import MarkdownWorkerUrl from "./markdown.worker.ts?worker&url"
import {
  applyMarkdownWorkerResponse,
  shouldReleaseMarkdownWorkerState,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
  type MarkdownWorkerState,
} from "./markdown-worker-protocol"
import {
  createMarkdownParseGate,
  MARKDOWN_PARSE_MAX_IN_FLIGHT,
  MARKDOWN_PARSE_MAX_LAG_FRAMES,
  type ParseGateTicket,
} from "./markdown-parse-backpressure"
import { createWorkerTransport } from "./markdown-worker-transport"
import { PERF, perfGauge, perfSample } from "../utils/perf"
import type { Projection } from "./markdown-stream"

// Streaming code keys are LRU-evicted at this cap (refreshed on every use).
export const MARKDOWN_HIGHLIGHT_KEY_LIMIT = 200

type HighlightPending = {
  key: string
  complete: boolean
  start: number
  resolve: (state: MarkdownWorkerState) => void
  reject: (error: Error) => void
}

type ProjectPending = {
  key: string
  start: number
  resolve: (projection: Projection) => void
  reject: (error: Error) => void
}

type ParsePending = {
  ticket?: ParseGateTicket
  start: number
  resolve: (html: string) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let disabled: Error | undefined
let nextID = 0
const pending = new Map<number, HighlightPending>()
const projects = new Map<number, ProjectPending>()
const parses = new Map<number, ParsePending>()
const states = new Map<string, MarkdownWorkerState>()
const keys = new Set<string>()
const latest = new Map<string, number>()

// Backpressure for parse requests: admit at most MAX_IN_FLIGHT, drop the
// oldest waiting request beyond the cap or after MAX_LAG_FRAMES lagging frames.
let parseFrame = 0
let parseFrameHandle: number | undefined
const advanceParseFrame = () => {
  parseFrame += 1
  parseFrameHandle = parseGate.pending() > 0 ? requestAnimationFrame(advanceParseFrame) : undefined
}
const parseGate = createMarkdownParseGate({
  maxInFlight: MARKDOWN_PARSE_MAX_IN_FLIGHT,
  maxLagFrames: MARKDOWN_PARSE_MAX_LAG_FRAMES,
  frames: () => parseFrame,
  onDrop: (ticket) => {
    for (const [id, parse] of parses) {
      if (parse.ticket !== ticket) continue
      parses.delete(id)
      parse.reject(new MarkdownWorkerBackpressureError())
      return
    }
  },
})

function ensureParseFrameClock() {
  if (parseFrameHandle !== undefined) return
  if (typeof requestAnimationFrame !== "function") return
  parseFrameHandle = requestAnimationFrame(advanceParseFrame)
}

function releaseParse(result: ParsePending) {
  if (result.ticket) parseGate.release(result.ticket)
  perfGauge("markdown.parse.inflight", parseGate.pending())
  if (result.start) perfSample("markdown.parse", performance.now() - result.start)
}
const transport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => {
    const result = pending.get(request.id)
    if (!result) return
    pending.delete(request.id)
    result.reject(new MarkdownWorkerSupersededError())
  },
})
const projectTransport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "project" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => {
    const result = projects.get(request.id)
    if (!result) return
    projects.delete(request.id)
    result.reject(new MarkdownWorkerSupersededError())
  },
})

export function parseMarkdown(text: string) {
  const instance = getWorker()
  const id = ++nextID
  const start = PERF.enabled ? performance.now() : 0
  const ticket = parseGate.acquire()
  perfGauge("markdown.parse.inflight", parseGate.pending())
  ensureParseFrameClock()
  return new Promise<string>((resolve, reject) => {
    parses.set(id, { ticket, start, resolve, reject })
    instance.postMessage({ type: "parse", id, text } satisfies MarkdownWorkerRequest)
  })
}

export function projectMarkdown(key: string, text: string, live: boolean) {
  getWorker()
  const id = ++nextID
  const start = PERF.enabled ? performance.now() : 0
  return new Promise<Projection>((resolve, reject) => {
    projects.set(id, { key, start, resolve, reject })
    projectTransport.send({ type: "project", id, key, text, live })
  })
}

export function disposeMarkdownProjection(key: string) {
  projectTransport.dispose(key)
  projects.forEach((request, id) => {
    if (request.key !== key) return
    projects.delete(id)
    request.reject(new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

export function highlightStreamingCode(key: string, text: string, language: string, complete = false) {
  const instance = getWorker()
  const id = ++nextID
  const start = PERF.enabled ? performance.now() : 0
  latest.set(key, id)
  keys.delete(key)
  keys.add(key)
  if (keys.size > MARKDOWN_HIGHLIGHT_KEY_LIMIT) disposeStreamingCode(keys.values().next().value!)
  return new Promise<MarkdownWorkerState>((resolve, reject) => {
    pending.set(id, { key, complete, start, resolve, reject })
    transport.send({ type: "highlight", id, key, text, language, complete })
  })
}

export function disposeStreamingCode(key: string) {
  keys.delete(key)
  latest.delete(key)
  states.delete(key)
  transport.dispose(key)
  pending.forEach((request, id) => {
    if (request.key !== key) return
    pending.delete(id)
    request.reject(new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

export class MarkdownWorkerDisposedError extends Error {}
export class MarkdownWorkerSupersededError extends Error {}
export class MarkdownWorkerUnavailableError extends Error {}
export class MarkdownWorkerBackpressureError extends Error {}

function getWorker() {
  if (worker) return worker
  if (disabled) throw new MarkdownWorkerUnavailableError(disabled.message)
  try {
    worker = new Worker(MarkdownWorkerUrl, { type: "module" })
  } catch (error) {
    disabled = error instanceof Error ? error : new Error(String(error))
    throw new MarkdownWorkerUnavailableError(disabled.message)
  }
  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    if (event.data.type === "parse") {
      const result = parses.get(event.data.id)
      if (!result) return
      parses.delete(event.data.id)
      releaseParse(result)
      result.resolve(event.data.html)
      return
    }
    if (event.data.type === "project") {
      const result = projects.get(event.data.id)
      if (!result) {
        projectTransport.complete(event.data.key, event.data.id)
        return
      }
      projects.delete(event.data.id)
      if (result.start) perfSample("markdown.project", performance.now() - result.start)
      result.resolve(event.data.projection)
      projectTransport.complete(event.data.key, event.data.id)
      return
    }
    if (event.data.type === "error") {
      const parsed = parses.get(event.data.id)
      if (parsed) {
        parses.delete(event.data.id)
        releaseParse(parsed)
        parsed.reject(new Error(event.data.message))
        return
      }
      const projected = projects.get(event.data.id)
      if (projected) {
        projects.delete(event.data.id)
        if (projected.start) perfSample("markdown.project", performance.now() - projected.start)
        projected.reject(new Error(event.data.message))
        projectTransport.complete(projected.key, event.data.id)
        return
      }
    }
    if (event.data.type === "superseded") {
      const projected = projects.get(event.data.id)
      if (projected) {
        projects.delete(event.data.id)
        if (projected.start) perfSample("markdown.project", performance.now() - projected.start)
        projected.reject(new MarkdownWorkerSupersededError())
        projectTransport.complete(projected.key, event.data.id)
        return
      }
    }
    const key = event.data.key
    if (!key) return
    const result = pending.get(event.data.id)
    if (!result) {
      transport.complete(key, event.data.id)
      return
    }
    pending.delete(event.data.id)
    if (result.start) perfSample("markdown.highlight", performance.now() - result.start)
    if (!keys.has(key)) {
      result.reject(new MarkdownWorkerDisposedError())
      transport.complete(key, event.data.id)
      return
    }
    if (event.data.type === "superseded") {
      result.reject(new MarkdownWorkerSupersededError())
      transport.complete(key, event.data.id)
      return
    }
    if (event.data.type === "error") {
      result.reject(new Error(event.data.message))
      transport.complete(key, event.data.id)
      return
    }
    const state = applyMarkdownWorkerResponse(states.get(key), event.data)
    if (shouldReleaseMarkdownWorkerState(result.complete, latest.get(key), event.data.id)) {
      states.delete(key)
      keys.delete(key)
      latest.delete(key)
    } else states.set(key, state)
    result.resolve(state)
    transport.complete(key, event.data.id)
  }
  const fail = (message: string) => {
    const error = new Error(message)
    disabled = error
    transport.reset()
    projectTransport.reset()
    pending.forEach((request) => request.reject(error))
    projects.forEach((request) => request.reject(error))
    parses.forEach((request) => request.reject(error))
    pending.clear()
    projects.clear()
    parses.clear()
    parseGate.clear()
    if (parseFrameHandle !== undefined) {
      cancelAnimationFrame(parseFrameHandle)
      parseFrameHandle = undefined
    }
    states.clear()
    keys.clear()
    latest.clear()
    worker?.terminate()
    worker = undefined
  }
  worker.onerror = (event) => fail(event.message || "Markdown highlighting worker failed")
  worker.onmessageerror = () => fail("Markdown worker response failed")
  return worker
}
