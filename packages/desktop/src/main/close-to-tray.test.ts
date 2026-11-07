import { describe, expect, test } from "bun:test"
import { createCloseToTraySetting } from "./close-to-tray"

function setup(initial?: unknown) {
  const store = new Map<string, unknown>()
  if (initial !== undefined) store.set("closeToTrayEnabled", initial)
  const setting = createCloseToTraySetting({
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
  })
  return { setting, store }
}

describe("close-to-tray setting", () => {
  test("defaults to off when the key is absent", () => {
    expect(setup().setting.get()).toBe(false)
  })

  test("reads stored true as on and everything else as off", () => {
    expect(setup(true).setting.get()).toBe(true)
    expect(setup(false).setting.get()).toBe(false)
    expect(setup("true").setting.get()).toBe(false)
    expect(setup(1).setting.get()).toBe(false)
  })

  test("writes the boolean through to the store", () => {
    const { setting, store } = setup()
    setting.set(true)
    expect(store.get("closeToTrayEnabled")).toBe(true)
    expect(setting.get()).toBe(true)
    setting.set(false)
    expect(store.get("closeToTrayEnabled")).toBe(false)
    expect(setting.get()).toBe(false)
  })
})
