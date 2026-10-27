import { describe, expect, test } from "bun:test"
import { isRendererOriginUrl, isTrustedSender, UntrustedSenderError } from "./renderer-origin"

const devUrl = "http://localhost:5173"

describe("isRendererOriginUrl", () => {
  test("accepts the packaged oc://renderer origin", () => {
    expect(isRendererOriginUrl("oc://renderer/index.html")).toBe(true)
    expect(isRendererOriginUrl("oc://renderer/assets/app.js")).toBe(true)
  })

  test("accepts the dev server origin when ELECTRON_RENDERER_URL matches", () => {
    expect(isRendererOriginUrl("http://localhost:5173/index.html", { devUrl })).toBe(true)
    expect(isRendererOriginUrl("http://127.0.0.1:5173/index.html", { devUrl })).toBe(false)
  })

  test("rejects foreign origins even when a dev url is set", () => {
    expect(isRendererOriginUrl("https://evil.example/index.html", { devUrl })).toBe(false)
    expect(isRendererOriginUrl("file:///C:/Windows/index.html", { devUrl })).toBe(false)
    expect(isRendererOriginUrl("oc://other/index.html", { devUrl })).toBe(false)
  })

  test("rejects missing and unparseable values", () => {
    expect(isRendererOriginUrl(undefined)).toBe(false)
    expect(isRendererOriginUrl(null)).toBe(false)
    expect(isRendererOriginUrl("not a url")).toBe(false)
  })

  test("html flag only accepts document responses", () => {
    expect(isRendererOriginUrl("oc://renderer/index.html", { html: true })).toBe(true)
    expect(isRendererOriginUrl("oc://renderer/assets/app.js", { html: true })).toBe(false)
  })

  test("dev origin is not trusted without a configured dev url", () => {
    expect(isRendererOriginUrl("http://localhost:5173/index.html")).toBe(false)
  })
})

describe("isTrustedSender", () => {
  test("accepts a sender frame on the app origin", () => {
    expect(isTrustedSender({ senderFrame: { url: "oc://renderer/index.html" } })).toBe(true)
    expect(isTrustedSender({ senderFrame: { url: "http://localhost:5173/index.html" } }, { devUrl })).toBe(true)
  })

  test("rejects foreign frames and destroyed frames", () => {
    expect(isTrustedSender({ senderFrame: { url: "https://evil.example/index.html" } }, { devUrl })).toBe(false)
    expect(isTrustedSender({ senderFrame: null }, { devUrl })).toBe(false)
    expect(isTrustedSender({})).toBe(false)
  })
})

describe("UntrustedSenderError", () => {
  test("names the channel and carries a typed name", () => {
    const error = new UntrustedSenderError("updater-install")
    expect(error.name).toBe("UntrustedSenderError")
    expect(error.message).toContain("updater-install")
    expect(error instanceof Error).toBe(true)
  })
})
