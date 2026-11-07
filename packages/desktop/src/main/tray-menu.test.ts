import { describe, expect, test } from "bun:test"
import { buildTrayMenu } from "./tray-menu"

const labels = {
  show: "Show CoderRupee",
  hide: "Hide CoderRupee",
  newSession: "New Session",
  checkForUpdates: "Check for Updates...",
  quit: "Quit",
}

function actions() {
  const picked: string[] = []
  return {
    picked,
    showWindow: () => picked.push("showWindow"),
    hideWindow: () => picked.push("hideWindow"),
    newSession: () => picked.push("newSession"),
    checkForUpdates: () => picked.push("checkForUpdates"),
    quit: () => picked.push("quit"),
  }
}

describe("tray menu", () => {
  test("offers hide while a window is visible and show while hidden", () => {
    const visible = buildTrayMenu({ windowVisible: true, updaterEnabled: true }, labels, actions())
    expect(visible[0]).toEqual({ id: "visibility", label: "Hide CoderRupee", enabled: true, onPick: expect.any(Function) })

    const hidden = buildTrayMenu({ windowVisible: false, updaterEnabled: true }, labels, actions())
    expect(hidden[0]).toEqual({ id: "visibility", label: "Show CoderRupee", enabled: true, onPick: expect.any(Function) })
  })

  test("keeps the tray order: visibility, new session, updates, separator, quit", () => {
    const menu = buildTrayMenu({ windowVisible: false, updaterEnabled: true }, labels, actions())
    expect(menu.map((item) => (item.type === "separator" ? "separator" : item.id))).toEqual([
      "visibility",
      "newSession",
      "checkForUpdates",
      "separator",
      "quit",
    ])
  })

  test("disables the update check when the updater is not enabled", () => {
    const menu = buildTrayMenu({ windowVisible: false, updaterEnabled: false }, labels, actions())
    const updates = menu.find((item) => item.type !== "separator" && item.id === "checkForUpdates")
    expect(updates).toMatchObject({ enabled: false, label: "Check for Updates..." })
  })

  test("routes each pick to its action", () => {
    const acts = actions()
    const menu = buildTrayMenu({ windowVisible: false, updaterEnabled: true }, labels, acts)
    for (const item of menu) {
      if (item.type !== "separator") item.onPick()
    }
    expect(acts.picked).toEqual(["showWindow", "newSession", "checkForUpdates", "quit"])
  })

  test("picks hide instead of show when a window is visible", () => {
    const acts = actions()
    const menu = buildTrayMenu({ windowVisible: true, updaterEnabled: true }, labels, acts)
    const visibility = menu[0]
    if (visibility.type === "separator") throw new Error("unexpected separator")
    visibility.onPick()
    expect(acts.picked).toEqual(["hideWindow"])
  })
})
