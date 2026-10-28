// Bounded in-flight gate for markdown worker parse requests. Without it every
// completed block in every mounted Markdown component posts to the single
// worker at once, so a long session or a large flush queues hundreds of
// requests (each holding its text) ahead of fresher content. The gate keeps at
// most MARKDOWN_PARSE_MAX_IN_FLIGHT requests outstanding, drops the OLDEST
// waiting request beyond the cap or when it has lagged more than
// MARKDOWN_PARSE_MAX_LAG_FRAMES frames (streaming content must never queue
// unboundedly), and always admits the newest request. Dropped requests reject
// with MarkdownWorkerBackpressureError; callers degrade that one block to the
// escaped-text fallback and it re-parses on the next mount.
//
// The frame clock is injected so bun tests drive lag deterministically; the
// production clock advances only while requests are waiting.

export const MARKDOWN_PARSE_MAX_IN_FLIGHT = 64
export const MARKDOWN_PARSE_MAX_LAG_FRAMES = 60

export type ParseGateTicket = { id: number; frame: number }

export function createMarkdownParseGate(input: {
  maxInFlight: number
  maxLagFrames: number
  frames: () => number
  onDrop: (ticket: ParseGateTicket) => void
}) {
  const waiting: ParseGateTicket[] = []
  let nextID = 0
  let dropped = 0
  let peak = 0

  const drop = (ticket: ParseGateTicket) => {
    const index = waiting.indexOf(ticket)
    if (index !== -1) waiting.splice(index, 1)
    dropped += 1
    input.onDrop(ticket)
  }

  const dropLagged = () => {
    while (waiting.length > 0) {
      const oldest = waiting[0]
      if (!oldest || input.frames() - oldest.frame <= input.maxLagFrames) return
      drop(oldest)
    }
  }

  return {
    acquire(): ParseGateTicket {
      dropLagged()
      while (waiting.length >= input.maxInFlight) {
        const oldest = waiting[0]
        if (!oldest) break
        drop(oldest)
      }
      const ticket: ParseGateTicket = { id: ++nextID, frame: input.frames() }
      waiting.push(ticket)
      peak = Math.max(peak, waiting.length)
      return ticket
    },
    release(ticket: ParseGateTicket) {
      const index = waiting.indexOf(ticket)
      if (index !== -1) waiting.splice(index, 1)
    },
    // Drops every waiting request silently; used when the worker itself is
    // reset and callers are already rejected through the failure path.
    clear() {
      waiting.length = 0
    },
    pending: () => waiting.length,
    dropped: () => dropped,
    peak: () => peak,
  }
}
