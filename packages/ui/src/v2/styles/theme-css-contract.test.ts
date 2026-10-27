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
})
