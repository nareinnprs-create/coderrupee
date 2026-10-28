import { describe, expect, test } from "bun:test"
import { channelStatusLine, otherChannel, switchDescription, updateTarget } from "../../src/component/dialog-update"
import { isVersionGreater, visibleNotice } from "../../src/context/update-notification"

describe("dialog update", () => {
  test("uses the normal update when a newer release exists", () => {
    expect(updateTarget({ current: "1.4.0", latest: "1.4.2" })).toEqual({ type: "latest", version: "1.4.2" })
  })

  test("offers nothing when already on the latest version", () => {
    expect(updateTarget({ current: "1.4.2", latest: "1.4.2" })).toBeUndefined()
  })

  test("never treats a newer major or an older release as a normal update", () => {
    expect(updateTarget({ current: "1.4.2", latest: "2.0.0" })).toBeUndefined()
    expect(updateTarget({ current: "1.4.2", latest: "1.4.1" })).toBeUndefined()
    expect(updateTarget({ current: "1.9.0", latest: "1.10.0" })).toEqual({ type: "latest", version: "1.10.0" })
  })

  test("skipping a version hides it until a newer one ships", () => {
    expect(visibleNotice({ type: "available", version: "1.4.2" }, {})).toEqual({ type: "available", version: "1.4.2" })
    expect(visibleNotice({ type: "available", version: "1.4.2" }, { skippedVersion: "1.4.2" })).toBeUndefined()
    expect(visibleNotice({ type: "available", version: "1.4.3" }, { skippedVersion: "1.4.2" })).toEqual({
      type: "available",
      version: "1.4.3",
    })
  })

  test("compares versions for skipping", () => {
    expect(isVersionGreater("1.4.2", "1.4.2")).toBe(false)
    expect(isVersionGreater("1.4.3", "1.4.2")).toBe(true)
    expect(isVersionGreater("1.5.0", "1.10.0")).toBe(false)
    expect(isVersionGreater("1.4.2", "1.4.2-beta.1")).toBe(true)
  })
})

describe("switch channel", () => {
  test("targets the opposite channel", () => {
    expect(otherChannel("stable")).toBe("beta")
    expect(otherChannel("beta")).toBe("stable")
  })

  test("describes the switch with the discovered target version", () => {
    expect(
      switchDescription({ channel: "stable", switchVersion: "1.4.3-beta.1" }),
    ).toBe("Latest beta version: 1.4.3-beta.1")
    expect(switchDescription({ channel: "beta", switchVersion: "1.4.2" })).toBe("Latest stable version: 1.4.2")
  })

  test("describes the switch honestly when no target version is discoverable", () => {
    expect(switchDescription({ channel: "stable" })).toBe("Couldn't discover a beta version; you can still switch.")
    expect(switchDescription({ channel: "beta" })).toBe("Couldn't discover a stable version; you can still switch.")
  })

  test("shows the channel and the last history entry in the dialog", () => {
    expect(channelStatusLine({ channel: "stable" })).toBe("Channel: stable")
    expect(
      channelStatusLine({
        channel: "beta",
        lastUpdate: { fromVersion: "1.4.1", toVersion: "1.4.2", channel: "stable", date: "2026-10-28T12:00:00.000Z" },
      }),
    ).toBe("Channel: beta · last update 1.4.1 → 1.4.2 on 2026-10-28")
  })
})
