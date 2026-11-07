import type { SidecarSupervisorState } from "../preload/types"

export type SidecarSupervisorTimers = {
  set(delayMs: number, onFire: () => void): unknown
  clear(timer: unknown): void
}

export type SidecarSupervisorLogger = {
  log(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export type SidecarSupervisorDeps = {
  /** Spawns (or respawns) the sidecar. Rejects when the attempt failed. */
  start: () => Promise<void>
  timers: SidecarSupervisorTimers
  log?: SidecarSupervisorLogger
  /** Consecutive failed attempts before the supervisor gives up. */
  maxRetries?: number
  /** First restart delay; doubles per attempt up to maxDelayMs. */
  baseDelayMs?: number
  maxDelayMs?: number
}

// Pure state machine for sidecar ownership: every unexpected exit schedules an
// exponential-backoff restart, and the persistent-failure state is surfaced so
// the renderer can be told the sidecar is gone for good. Timers are injectable
// so tests drive the clock; the supervisor itself never spawns or kills
// processes — the owner reports exits through notifyExit.
export function createSidecarSupervisor(deps: SidecarSupervisorDeps) {
  const maxRetries = deps.maxRetries ?? 5
  const baseDelayMs = deps.baseDelayMs ?? 500
  const maxDelayMs = deps.maxDelayMs ?? 8000

  let state: SidecarSupervisorState = "stopped"
  let attempt = 0
  let intentionalStop = false
  let disposed = false
  let timer: unknown
  // Bumped on every external transition so in-flight start attempts from an
  // earlier generation cannot resurrect stale state.
  let epoch = 0
  const listeners = new Set<(current: SidecarSupervisorState) => void>()

  const setState = (next: SidecarSupervisorState) => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(state)
  }

  const cancelTimer = () => {
    if (timer === undefined) return
    deps.timers.clear(timer)
    timer = undefined
  }

  const scheduleRetry = () => {
    if (attempt >= maxRetries) {
      deps.log?.error("sidecar restart attempts exhausted", { attempt })
      setState("failed")
      return
    }
    attempt += 1
    const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
    const runEpoch = epoch
    deps.log?.log("sidecar restart scheduled", { attempt, delayMs })
    setState("restarting")
    timer = deps.timers.set(delayMs, () => {
      timer = undefined
      if (disposed || epoch !== runEpoch) return
      void runRetry()
    })
  }

  const runRetry = async () => {
    setState("starting")
    const runEpoch = epoch
    try {
      await deps.start()
    } catch (error) {
      if (disposed || epoch !== runEpoch) return
      deps.log?.error("sidecar restart attempt failed", { attempt, error: String(error) })
      scheduleRetry()
      return
    }
    if (disposed || epoch !== runEpoch) return
    attempt = 0
    setState("running")
  }

  return {
    getState: () => state,
    subscribe(listener: (current: SidecarSupervisorState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // The initial start deliberately propagates failure to the caller so
    // first-launch behavior (fatal initialization error) stays unchanged.
    async start() {
      if (disposed) return
      intentionalStop = false
      attempt = 0
      cancelTimer()
      epoch += 1
      const runEpoch = epoch
      setState("starting")
      try {
        await deps.start()
      } catch (error) {
        if (disposed || epoch !== runEpoch) throw error
        setState("failed")
        throw error
      }
      if (disposed || epoch !== runEpoch) return
      setState("running")
    },
    notifyExit(options: { expected: boolean }) {
      if (disposed) return
      epoch += 1
      cancelTimer()
      if (options.expected || intentionalStop) {
        attempt = 0
        setState("stopped")
        return
      }
      deps.log?.log("sidecar exited unexpectedly", {})
      setState("crashed")
      scheduleRetry()
    },
    // Owner-requested stop (teardown, kill-sidecar): cancels pending restarts
    // and makes a racing exit event a no-op.
    stop() {
      if (disposed) return
      intentionalStop = true
      epoch += 1
      cancelTimer()
      attempt = 0
      setState("stopped")
    },
    dispose() {
      disposed = true
      epoch += 1
      cancelTimer()
      listeners.clear()
      setState("stopped")
    },
  }
}
