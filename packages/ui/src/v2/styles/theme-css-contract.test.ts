import { describe, expect, test } from "bun:test"
import { mapV2Semantics } from "../../theme/v2/mapping"

const css = await Bun.file(new URL("./theme.css", import.meta.url)).text()

// The disabled prefers-color-scheme fallback lives inside a comment; only live
// custom properties are part of the contract.
const live = css.replace(/\/\*[\s\S]*?\*\//g, "")

function customProperties(selector: string): Record<string, string> {
  const start = live.indexOf(selector)
  if (start === -1) throw new Error(`selector not found in theme.css: ${selector}`)
  const open = live.indexOf("{", start)
  let depth = 0
  let end = open
  for (let i = open; i < live.length; i++) {
    if (live[i] === "{") depth++
    if (live[i] === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = live.slice(open + 1, end)
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  )
}

// Core grey/scale set that theme.css restates by hand; the runtime mapping in
// theme/v2/mapping.ts is the source of truth.
const contractTokens = [
  "v2-background-bg-base",
  "v2-background-bg-deep",
  "v2-background-bg-layer-01",
  "v2-background-bg-layer-02",
  "v2-background-bg-layer-03",
  "v2-background-bg-layer-04",
  "v2-background-bg-inverse",
  "v2-background-bg-contrast",
  "v2-background-bg-button-neutral",
  "v2-text-text-inverse",
  "v2-text-text-contrast",
]

const dimensionTokens = {
  "v2-type-body-size": "13px",
  "v2-type-body-line": "20px",
  "v2-type-label-size": "11px",
  "v2-space-4": "8px",
  "v2-space-5": "12px",
  "v2-radius-sm": "4px",
  "v2-radius-md": "6px",
  "v2-control-height-base": "28px",
  "v2-focus-ring-width": "2px",
  "v2-focus-ring-offset": "1px",
} as const

describe("v2 theme.css static/runtime token contract", () => {
  test("light :root tokens equal the runtime mapping", () => {
    const staticTokens = customProperties(":root")
    const runtime = mapV2Semantics(false)
    for (const token of contractTokens) {
      expect(staticTokens[`--${token}`]).toBe(runtime[token])
    }
  })

  test("dark [data-color-scheme] tokens equal the runtime mapping", () => {
    const staticTokens = customProperties('[data-color-scheme="dark"]')
    const runtime = mapV2Semantics(true)
    for (const token of contractTokens) {
      expect(staticTokens[`--${token}`]).toBe(runtime[token])
    }
  })

  test("shared v2 dimensional tokens are declared", () => {
    const staticTokens = customProperties(":root")
    for (const [token, value] of Object.entries(dimensionTokens)) {
      expect(staticTokens[`--${token}`]).toBe(value)
    }
  })

  test("confirmed v2 controls consume shared tokens", async () => {
    const components = ["button-v2", "menu-v2", "select-v2", "text-input-v2", "tabs-v2"]
    for (const component of components) {
      const componentCss = await Bun.file(new URL(`../components/${component}.css`, import.meta.url)).text()
      expect(componentCss).toMatch(/var\(--v2-(?:space|radius|type|control|focus)-/)
    }
  })
})
