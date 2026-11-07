// Pure decision engine and wire contract for native session notifications.
// Window focus and session visibility are inputs, so this module stays free of
// DOM and Electron access and is fully unit-testable.

export type SessionEventKind = "completed" | "failed" | "needs-attention" | "silent"
export type NotificationUrgency = "low" | "normal" | "critical"

// Route payload callers pass alongside a notification so platforms can route a
// notification click back to the session instead of an opaque callback.
export type NotificationRouteOptions = {
  urgency?: NotificationUrgency
  directory?: string
  sessionID?: string
}

export type SessionNotificationRules = {
  sessionEvent: SessionEventKind
  windowFocused: boolean
  sessionVisible: boolean
  setting: boolean
  title: string
  body?: string
}

export type SessionNotificationDecision = {
  notify: boolean
  urgency: NotificationUrgency
  title: string
  body: string
}

const urgencyByEvent: Record<SessionEventKind, NotificationUrgency> = {
  completed: "normal",
  failed: "critical",
  "needs-attention": "critical",
  silent: "normal",
}

// Rules:
// - silent events never notify (state changes without user-facing impact)
// - the notifications setting off suppresses every event kind
// - the session the user is actively looking at never notifies: the state is
//   already on screen, including permission prompts rendered inside it
// - completed only interrupts an unfocused window; failed and needs-attention
//   break through focus because they demand action in a different session
export function decideSessionNotification(input: SessionNotificationRules): SessionNotificationDecision {
  const decision: SessionNotificationDecision = {
    notify: false,
    urgency: urgencyByEvent[input.sessionEvent],
    title: input.title,
    body: input.body ?? "",
  }
  if (input.sessionEvent === "silent") return decision
  if (!input.setting) return decision
  if (input.sessionVisible) return decision
  if (input.sessionEvent === "completed" && input.windowFocused) return decision
  return { ...decision, notify: true }
}

export const NOTIFICATION_RATE_LIMIT_MS = 60_000

export function createNotificationRateLimiter(options?: { now?: () => number; windowMs?: number }) {
  const now = options?.now ?? Date.now
  const windowMs = options?.windowMs ?? NOTIFICATION_RATE_LIMIT_MS
  const lastAllowedAt = new Map<string, number>()
  return {
    allow(key: string) {
      const time = now()
      const last = lastAllowedAt.get(key)
      if (last !== undefined && time - last < windowMs) return false
      lastAllowedAt.set(key, time)
      return true
    },
  }
}

export type SessionNotificationInput = SessionNotificationRules & { sessionID?: string }

// Composes the rules with the per-session, per-event spam limiter. Permission
// prompts (needs-attention) bypass the limiter so a rate-limited stream can
// never hide an approval request.
export function createSessionNotificationGate(options?: { now?: () => number; windowMs?: number }) {
  const limiter = createNotificationRateLimiter(options)
  return (input: SessionNotificationInput): SessionNotificationDecision => {
    const decision = decideSessionNotification(input)
    if (!decision.notify) return decision
    if (input.sessionEvent === "needs-attention") return decision
    if (!limiter.allow(`${input.sessionEvent}:${input.sessionID ?? "*"}`)) return { ...decision, notify: false }
    return decision
  }
}

// Host part of the click-through deep link used by the desktop transport to
// route a notification click back to the session (renderer side parses it in
// pages/layout/deep-links.ts).
export const SESSION_DEEP_LINK_HOST = "session"

export function buildSessionDeepLink(directory: string, sessionID?: string) {
  const params = new URLSearchParams({ directory })
  if (sessionID) params.set("id", sessionID)
  return `coderrupee://${SESSION_DEEP_LINK_HOST}?${params.toString()}`
}

// Wire contract for the desktop `notify` IPC channel. directory/sessionID
// drive click-through routing via the coderrupee://session deep link.
export type DesktopNotificationRequest = {
  title: string
  body?: string
  urgency?: NotificationUrgency
  directory?: string
  sessionID?: string
}

export type DesktopNotificationResult = { shown: boolean }
