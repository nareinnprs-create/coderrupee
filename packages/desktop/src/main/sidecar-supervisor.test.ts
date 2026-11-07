import { describe, expect, test } from "bun:test"
import { createSidecarSupervisor, type SidecarSupervisorTimers } from "./sidecar-supervisor"

function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timers: SidecarSupervisorTimers = {
    set: (delayMs, onFire) => {
      const id = nextId++
      pending.set(id, { at: now + delayMs, fn: onFire })
      return id
    },
    clear: (id) => {
      pending.delete(id as number)
    },
  }
  return {
    timers,
    now: () => now,
    scheduled: () => pending.size,
    advance(stepMs: number) {
      const until = now + stepMs
      while (true) {
        const due = [...pending.entries()].filter(([, entry]) => entry.at <= until).sort((a, b) => a[1].at - b[1].at)
        const first = due[0]
        if (!first) break
        const [id, entry] = first
        now = entry.at
        pending.delete(id)
        entry.fn()
      }
      now = until
    },
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(options?: { maxRetries?: number; start?: () => Promise<void> }) {
  const clock = fakeTimers()
  const states: string[] = []
  const attempts: number[] = []
  let remainingFailures = 0
  const gates: ReturnType<typeof deferred>[] = []
  const supervisor = createSidecarSupervisor({
    maxRetries: options?.maxRetries,
    timers: clock.timers,
    start:
      options?.start ??
      (async () => {
        attempts.push(clock.now())
        if (remainingFailures > 0) {
          remainingFailures--
          throw new Error("spawn failed")
        }
      }),
  })
  supervisor.subscribe((state) => states.push(state))
  return {
    supervisor,
    clock,
    states,
    attempts,
    // Lets the microtasks of a fired restart attempt settle before asserting.
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    setRemainingFailures: (count: number) => {
      remainingFailures = count
    },
    gate: () => {
      const gate = deferred()
      gates.push(gate)
      attempts.push(clock.now())
      return gate
    },
    releaseAll: () => gates.forEach((gate) => gate.resolve()),
  }
}

describe("sidecar supervisor", () => {
  test("moves stopped -> starting -> running on a successful start", async () => {
    const app = setup()
    const started = app.supervisor.start()
    expect(app.supervisor.getState()).toBe("starting")
    await started
    expect(app.supervisor.getState()).toBe("running")
    expect(app.states).toEqual(["starting", "running"])
  })

  test("propagates the initial start failure and lands in failed", async () => {
    const app = setup()
    app.setRemainingFailures(1)
    await app.supervisor.start().catch(() => undefined)
    expect(app.supervisor.getState()).toBe("failed")
    expect(app.clock.scheduled()).toBe(0)
  })

  test("restarts after an unexpected exit with exponential backoff", async () => {
    const app = setup()
    await app.supervisor.start()
    app.supervisor.notifyExit({ expected: false })
    // crashed is transient: the retry is armed synchronously.
    expect(app.supervisor.getState()).toBe("restarting")
    expect(app.clock.scheduled()).toBe(1)

    app.clock.advance(499)
    expect(app.attempts).toHaveLength(1)
    app.clock.advance(1)
    await app.settle()
    expect(app.attempts).toHaveLength(2)
    expect(app.supervisor.getState()).toBe("running")
    expect(app.states.slice(-3)).toEqual(["restarting", "starting", "running"])
  })

  test("doubles the delay per attempt up to the cap, then fails", async () => {
    const app = setup()
    await app.supervisor.start()
    // Five restart attempts fire at 500, 1000, 2000, 4000, 8000 ms; when the
    // last one fails the retries are exhausted.
    app.setRemainingFailures(5)
    app.supervisor.notifyExit({ expected: false })
    for (const gap of [500, 1000, 2000, 4000, 8000]) {
      expect(app.supervisor.getState()).toBe("restarting")
      app.clock.advance(gap)
      await app.settle()
    }
    expect(app.supervisor.getState()).toBe("failed")
    expect(app.attempts).toHaveLength(6)
    const gaps = app.attempts.slice(1).map((at, index) => at - app.attempts[index])
    expect(gaps).toEqual([500, 1000, 2000, 4000, 8000])
    expect(app.clock.scheduled()).toBe(0)
  })

  test("surfaces persistent failure after maxRetries restarts", async () => {
    const app = setup({ maxRetries: 2 })
    await app.supervisor.start()
    app.setRemainingFailures(2)
    app.supervisor.notifyExit({ expected: false })
    app.clock.advance(500)
    await app.settle()
    expect(app.supervisor.getState()).toBe("restarting")
    app.clock.advance(1000)
    await app.settle()
    expect(app.supervisor.getState()).toBe("failed")
    expect(app.attempts).toHaveLength(3)
    expect(app.clock.scheduled()).toBe(0)
  })

  test("an expected exit stops cleanly without scheduling a restart", async () => {
    const app = setup()
    await app.supervisor.start()
    app.supervisor.notifyExit({ expected: true })
    expect(app.supervisor.getState()).toBe("stopped")
    expect(app.clock.scheduled()).toBe(0)
  })

  test("stop cancels a pending restart and ignores a racing unexpected exit", async () => {
    const app = setup()
    await app.supervisor.start()
    app.supervisor.notifyExit({ expected: false })
    expect(app.clock.scheduled()).toBe(1)
    app.supervisor.stop()
    expect(app.supervisor.getState()).toBe("stopped")
    expect(app.clock.scheduled()).toBe(0)
    app.supervisor.notifyExit({ expected: false })
    expect(app.supervisor.getState()).toBe("stopped")
    expect(app.clock.scheduled()).toBe(0)
  })

  test("a successful restart resets the attempt series", async () => {
    const app = setup({ maxRetries: 2 })
    await app.supervisor.start()
    // First series: restart attempt succeeds, so the counter goes back to zero.
    app.supervisor.notifyExit({ expected: false })
    app.clock.advance(500)
    await app.settle()
    expect(app.supervisor.getState()).toBe("running")
    // Second series restarts at the base delay again, not the escalated one.
    app.supervisor.notifyExit({ expected: false })
    app.clock.advance(499)
    expect(app.attempts).toHaveLength(2)
    app.clock.advance(1)
    await app.settle()
    expect(app.supervisor.getState()).toBe("running")
    const gaps = app.attempts.slice(1).map((at, index) => at - app.attempts[index])
    expect(gaps).toEqual([500, 500])
  })
})
