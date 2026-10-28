import { describe, expect, test } from "bun:test"
import { parseNotificationRequest } from "./notifications"

describe("parseNotificationRequest", () => {
  test("accepts a full request", () => {
    expect(
      parseNotificationRequest({
        title: "Permission required",
        body: "Fix login in demo",
        urgency: "critical",
        directory: "C:/repo",
        sessionID: "ses_1",
      }),
    ).toEqual({
      title: "Permission required",
      body: "Fix login in demo",
      urgency: "critical",
      directory: "C:/repo",
      sessionID: "ses_1",
    })
  })

  test("rejects non-objects and empty titles", () => {
    expect(parseNotificationRequest(null)).toBeNull()
    expect(parseNotificationRequest(undefined)).toBeNull()
    expect(parseNotificationRequest("notify")).toBeNull()
    expect(parseNotificationRequest([])).toBeNull()
    expect(parseNotificationRequest({})).toBeNull()
    expect(parseNotificationRequest({ title: "   " })).toBeNull()
    expect(parseNotificationRequest({ title: 42 })).toBeNull()
  })

  test("trims and bounds every field", () => {
    const request = parseNotificationRequest({
      title: `  ${"t".repeat(300)}  `,
      body: "b".repeat(900),
      directory: "d".repeat(2000),
      sessionID: "s".repeat(500),
    })
    expect(request?.title.length).toBe(200)
    expect(request?.body?.length).toBe(500)
    expect(request?.directory?.length).toBe(1024)
    expect(request?.sessionID?.length).toBe(200)
  })

  test("drops unknown urgency values", () => {
    expect(parseNotificationRequest({ title: "t", urgency: "urgent" }).urgency).toBeUndefined()
    expect(parseNotificationRequest({ title: "t", urgency: "critical" }).urgency).toBe("critical")
  })

  test("omits absent optional fields instead of passing nulls", () => {
    expect(parseNotificationRequest({ title: "t" })).toEqual({ title: "t" })
  })
})
