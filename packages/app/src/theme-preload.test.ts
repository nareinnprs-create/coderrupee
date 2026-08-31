import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to coderrupee before mount", () => {
    localStorage.setItem("coderrupee-theme-id", "oc-1")
    localStorage.setItem("coderrupee-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("coderrupee-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("coderrupee")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("coderrupee-theme-id")).toBe("coderrupee")
    expect(localStorage.getItem("coderrupee-theme-css-light")).toBeNull()
    expect(localStorage.getItem("coderrupee-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("coderrupee-theme-id", "nightowl")
    localStorage.setItem("coderrupee-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
