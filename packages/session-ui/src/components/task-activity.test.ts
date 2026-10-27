import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@coderrupee/sdk/v2"
import { latestTaskActivity } from "./task-activity"

const message = (id: string): Message => ({ id }) as Message

const toolPart = (id: string, tool: string, title?: string): Part =>
  ({
    id,
    type: "tool",
    tool,
    state: { status: "completed", input: {}, output: "", title: title ?? tool, metadata: {}, time: {} },
  }) as Part

const textPart = (id: string, text: string): Part => ({ id, type: "text", text }) as Part

describe("latest task activity", () => {
  test("returns the newest tool label across child messages", () => {
    const messages = [message("m1"), message("m2")]
    const parts: Record<string, Part[]> = {
      m1: [toolPart("p1", "read", "Read")],
      m2: [textPart("p2", "half-written"), toolPart("p3", "grep", "Grep")],
    }
    const describe = (part: Part) => (part.type === "tool" ? (part.state as { title: string }).title : undefined)
    expect(latestTaskActivity(messages, (id) => parts[id], describe)).toBe("Grep")
  })

  test("keeps scanning backwards past parts without labels", () => {
    const messages = [message("m1"), message("m2")]
    const parts: Record<string, Part[]> = {
      m1: [toolPart("p1", "read", "Read")],
      m2: [textPart("p2", "answer draft")],
    }
    const describe = (part: Part) => (part.type === "tool" ? (part.state as { title: string }).title : undefined)
    expect(latestTaskActivity(messages, (id) => parts[id], describe)).toBe("Read")
  })

  test("returns undefined when the child has no describable parts", () => {
    const messages = [message("m1")]
    const describe = () => undefined
    expect(latestTaskActivity(messages, () => undefined, describe)).toBeUndefined()
    expect(latestTaskActivity([], () => undefined, describe)).toBeUndefined()
  })
})
