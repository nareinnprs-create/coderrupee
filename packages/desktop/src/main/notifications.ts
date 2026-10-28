import type { DesktopNotificationRequest, NotificationUrgency } from "@coderrupee/app/notification-decision"

const MAX_TITLE = 200
const MAX_BODY = 500
const MAX_DIRECTORY = 1024
const MAX_SESSION_ID = 200

const URGENCIES: readonly NotificationUrgency[] = ["low", "normal", "critical"]

function bounded(value: unknown, max: number) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

// Pure so the renderer->main notification payload contract stays unit-testable
// without Electron. Anything that does not survive validation is dropped
// rather than shown half-formed.
export function parseNotificationRequest(value: unknown): DesktopNotificationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const title = bounded(input.title, MAX_TITLE)
  if (!title) return null
  const urgency = URGENCIES.find((candidate) => candidate === input.urgency)
  return {
    title,
    body: bounded(input.body, MAX_BODY),
    urgency,
    directory: bounded(input.directory, MAX_DIRECTORY),
    sessionID: bounded(input.sessionID, MAX_SESSION_ID),
  }
}
