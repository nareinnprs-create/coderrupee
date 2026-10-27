import { describe, expect, test } from "bun:test"
import { activateOnKeyDown } from "./tabs-v2"

describe("activateOnKeyDown", () => {
  test("activates on Enter and Space and prevents the default scroll/click behavior", () => {
    for (const key of ["Enter", " "]) {
      let activated = 0
      let prevented = false
      const handled = activateOnKeyDown({ key, preventDefault: () => (prevented = true) }, () => activated++)
      expect(handled).toBe(true)
      expect(prevented).toBe(true)
      expect(activated).toBe(1)
    }
  })

  test("ignores other keys", () => {
    let activated = 0
    let prevented = false
    const handled = activateOnKeyDown({ key: "ArrowLeft", preventDefault: () => (prevented = true) }, () => activated++)
    expect(handled).toBe(false)
    expect(prevented).toBe(false)
    expect(activated).toBe(0)
  })
})
