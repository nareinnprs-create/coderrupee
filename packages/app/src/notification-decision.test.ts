import { describe, expect, test } from "bun:test"
import {
  buildSessionDeepLink,
  createNotificationRateLimiter,
  createSessionNotificationGate,
  decideSessionNotification,
  NOTIFICATION_RATE_LIMIT_MS,
  type SessionEventKind,
} from "./notification-decision"

const events: SessionEventKind[] = ["completed", "failed", "needs-attention", "silent"]

const cell = (sessionEvent: SessionEventKind, setting: boolean, windowFocused: boolean, sessionVisible: boolean) =>
  decideSessionNotification({
    sessionEvent,
    setting,
    windowFocused,
    sessionVisible,
    title: "t",
    body: "b",
  })

// Expected notify per (event, setting, windowFocused, sessionVisible).
const expectNotify = (sessionEvent: SessionEventKind, setting: boolean, windowFocused: boolean, sessionVisible: boolean) => {
  if (!setting) return false
  if (sessionEvent === "silent") return false
  if (sessionVisible) return false
  if (sessionEvent === "completed" && windowFocused) return false
  return true
}

describe("decideSessionNotification matrix", () => {
  for (const sessionEvent of events) {
    for (const setting of [true, false]) {
      for (const windowFocused of [true, false]) {
        for (const sessionVisible of [true, false]) {
          const key = `${sessionEvent} setting=${setting} focused=${windowFocused} visible=${sessionVisible}`
          test(key, () => {
            expect(cell(sessionEvent, setting, windowFocused, sessionVisible).notify).toBe(
              expectNotify(sessionEvent, setting, windowFocused, sessionVisible),
            )
          })
        }
      }
    }
  }
})

describe("decideSessionNotification", () => {
  test("completed stays quiet while the window is focused", () => {
    expect(cell("completed", true, true, false).notify).toBe(false)
    expect(cell("completed", true, false, false).notify).toBe(true)
  })

  test("failed and permission prompts break through a focused window", () => {
    expect(cell("failed", true, true, false).notify).toBe(true)
    expect(cell("needs-attention", true, true, false).notify).toBe(true)
  })

  test("the session the user is looking at never notifies, even for permission prompts", () => {
    expect(cell("completed", true, false, true).notify).toBe(false)
    expect(cell("failed", true, true, true).notify).toBe(false)
    expect(cell("needs-attention", true, false, true).notify).toBe(false)
  })

  test("setting off suppresses everything", () => {
    for (const sessionEvent of events) {
      expect(cell(sessionEvent, false, false, false).notify).toBe(false)
    }
  })

  test("urgency and copy pass through", () => {
    expect(cell("completed", true, false, false)).toEqual({
      notify: true,
      urgency: "normal",
      title: "t",
      body: "b",
    })
    expect(cell("failed", true, false, false).urgency).toBe("critical")
    expect(cell("needs-attention", true, false, false).urgency).toBe("critical")
  })

  test("missing body defaults to empty string", () => {
    expect(decideSessionNotification({ sessionEvent: "failed", setting: true, windowFocused: false, sessionVisible: false, title: "t" }).body).toBe("")
  })
})

describe("createNotificationRateLimiter", () => {
  test("allows the first call and blocks within the window", () => {
    let time = 1_000
    const limiter = createNotificationRateLimiter({ now: () => time })
    expect(limiter.allow("completed:s1")).toBe(true)
    expect(limiter.allow("completed:s1")).toBe(false)
    time = 1_000 + NOTIFICATION_RATE_LIMIT_MS - 1
    expect(limiter.allow("completed:s1")).toBe(false)
    time = 1_000 + NOTIFICATION_RATE_LIMIT_MS
    expect(limiter.allow("completed:s1")).toBe(true)
  })

  test("budgets per event type and per session", () => {
    let time = 1_000
    const limiter = createNotificationRateLimiter({ now: () => time })
    expect(limiter.allow("completed:s1")).toBe(true)
    expect(limiter.allow("failed:s1")).toBe(true)
    expect(limiter.allow("completed:s2")).toBe(true)
    expect(limiter.allow("failed:s1")).toBe(false)
    expect(limiter.allow("completed:s1")).toBe(false)
  })
})

describe("createSessionNotificationGate", () => {
  test("rate-limits completed per session at one per minute", () => {
    let time = 1_000
    const gate = createSessionNotificationGate({ now: () => time })
    const input = { sessionEvent: "completed" as const, windowFocused: false, sessionVisible: false, setting: true, sessionID: "s1", title: "t" }
    expect(gate(input).notify).toBe(true)
    expect(gate(input).notify).toBe(false)
    time += NOTIFICATION_RATE_LIMIT_MS
    expect(gate(input).notify).toBe(true)
  })

  test("failed and completed have independent budgets for the same session", () => {
    const gate = createSessionNotificationGate({ now: () => 1_000 })
    expect(gate({ sessionEvent: "completed", windowFocused: false, sessionVisible: false, setting: true, sessionID: "s1", title: "t" }).notify).toBe(true)
    expect(gate({ sessionEvent: "failed", windowFocused: false, sessionVisible: false, setting: true, sessionID: "s1", title: "t" }).notify).toBe(true)
  })

  test("permission prompts bypass the limiter but not the rules", () => {
    const gate = createSessionNotificationGate({ now: () => 1_000 })
    const input = { sessionEvent: "needs-attention" as const, windowFocused: true, sessionVisible: false, setting: true, sessionID: "s1", title: "t" }
    expect(gate(input).notify).toBe(true)
    expect(gate(input).notify).toBe(true)
    expect(gate({ ...input, setting: false }).notify).toBe(false)
    expect(gate({ ...input, sessionVisible: true }).notify).toBe(false)
  })

  test("suppressed decisions keep their urgency and copy", () => {
    const gate = createSessionNotificationGate({ now: () => 1_000 })
    gate({ sessionEvent: "completed", windowFocused: false, sessionVisible: false, setting: true, sessionID: "s1", title: "t", body: "b" })
    expect(gate({ sessionEvent: "completed", windowFocused: false, sessionVisible: false, setting: true, sessionID: "s1", title: "t", body: "b" })).toEqual({
      notify: false,
      urgency: "normal",
      title: "t",
      body: "b",
    })
  })
})

describe("buildSessionDeepLink", () => {
  test("builds a session deep link with directory and optional id", () => {
    expect(buildSessionDeepLink("/repo")).toBe("coderrupee://session?directory=%2Frepo")
    expect(buildSessionDeepLink("/repo", "ses_1")).toBe("coderrupee://session?directory=%2Frepo&id=ses_1")
  })
})
