import type { Message, Part } from "@coderrupee/sdk/v2"

// Most recent activity label for a running subagent session. Messages are
// stored oldest-first, so the scan walks backwards and returns the newest part
// the describe callback accepts.
export const latestTaskActivity = (
  messages: Message[],
  partsOf: (messageID: string) => Part[] | undefined,
  describe: (part: Part) => string | undefined,
) => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const parts = partsOf(messages[index]!.id) ?? []
    for (let position = parts.length - 1; position >= 0; position--) {
      const value = describe(parts[position]!)
      if (value) return value
    }
  }
  return undefined
}
