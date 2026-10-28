import { expect, test } from "bun:test"
import {
  createMarkdownParseGate,
  MARKDOWN_PARSE_MAX_IN_FLIGHT,
  MARKDOWN_PARSE_MAX_LAG_FRAMES,
  type ParseGateTicket,
} from "./markdown-parse-backpressure"

test("constants are configurable and non-zero", () => {
  expect(MARKDOWN_PARSE_MAX_IN_FLIGHT).toBeGreaterThan(0)
  expect(MARKDOWN_PARSE_MAX_LAG_FRAMES).toBeGreaterThan(0)
})

test("fill beyond cap drops the oldest and the newest survives", () => {
  const dropped: number[] = []
  const gate = createMarkdownParseGate({
    maxInFlight: 4,
    maxLagFrames: 60,
    frames: () => 0,
    onDrop: (ticket: ParseGateTicket) => dropped.push(ticket.id),
  })

  const admitted: number[] = []
  for (let index = 0; index < 10; index++) admitted.push(gate.acquire().id)

  // Oldest tickets 1-6 were dropped as newer ones arrived; 7-10 stay in flight.
  expect(dropped).toEqual([1, 2, 3, 4, 5, 6])
  expect(admitted).toHaveLength(10)
  expect(admitted.at(-1)).toBe(10)
  expect(gate.pending()).toBe(4)
  expect(gate.dropped()).toBe(6)
})

test("lagging frames drop stale heads before the cap is reached", () => {
  let frame = 0
  const dropped: number[] = []
  const gate = createMarkdownParseGate({
    maxInFlight: 8,
    maxLagFrames: 10,
    frames: () => frame,
    onDrop: (ticket) => dropped.push(ticket.id),
  })

  gate.acquire()
  gate.acquire()
  expect(gate.pending()).toBe(2)
  frame = 11
  gate.acquire()
  // Both earlier tickets lagged more than maxLagFrames past their acquire frame.
  expect(dropped).toEqual([1, 2])
  expect(gate.pending()).toBe(1)
  expect(gate.dropped()).toBe(2)
})

test("release removes a ticket from the in-flight count", () => {
  const dropped: number[] = []
  const gate = createMarkdownParseGate({
    maxInFlight: 2,
    maxLagFrames: 60,
    frames: () => 0,
    onDrop: (ticket) => dropped.push(ticket.id),
  })

  gate.acquire()
  gate.acquire()
  expect(gate.pending()).toBe(2)
  expect(dropped).toEqual([])
  gate.release(gate.acquire())
  expect(gate.pending()).toBe(1)
})

test("clear empties the gate without counting drops", () => {
  const dropped: number[] = []
  const gate = createMarkdownParseGate({
    maxInFlight: 2,
    maxLagFrames: 60,
    frames: () => 0,
    onDrop: (ticket) => dropped.push(ticket.id),
  })

  gate.acquire()
  gate.acquire()
  gate.clear()
  expect(gate.pending()).toBe(0)
  expect(gate.dropped()).toBe(0)
  expect(dropped).toEqual([])
})

test("production defaults stay bounded", () => {
  const dropped: number[] = []
  const gate = createMarkdownParseGate({
    maxInFlight: MARKDOWN_PARSE_MAX_IN_FLIGHT,
    maxLagFrames: MARKDOWN_PARSE_MAX_LAG_FRAMES,
    frames: () => 0,
    onDrop: (ticket) => dropped.push(ticket.id),
  })

  for (let index = 0; index < MARKDOWN_PARSE_MAX_IN_FLIGHT * 3; index++) gate.acquire()
  expect(gate.pending()).toBe(MARKDOWN_PARSE_MAX_IN_FLIGHT)
  expect(gate.dropped()).toBe(MARKDOWN_PARSE_MAX_IN_FLIGHT * 2)
  expect(dropped.length).toBe(MARKDOWN_PARSE_MAX_IN_FLIGHT * 2)
})
