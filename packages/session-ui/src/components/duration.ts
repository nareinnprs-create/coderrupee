export type DurationParts =
  | { kind: "seconds"; count: number }
  | { kind: "minutesSeconds"; minutes: number; seconds: number }

// Shared formatting policy for elapsed-time labels ("42s", "3m 12s"). The
// caller maps the parts onto locale strings.
export const durationParts = (ms: number): DurationParts => {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return { kind: "seconds", count: total }
  return { kind: "minutesSeconds", minutes: Math.floor(total / 60), seconds: total % 60 }
}
