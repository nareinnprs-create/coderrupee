import { describe, expect, beforeEach, afterEach } from "bun:test"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Global } from "@coderrupee/core/global"
import { Auth } from "../../src/auth"
import { Keyring } from "../../src/auth/keyring"
import { testEffect } from "../lib/effect"

const authFile = path.join(Global.Path.data, "auth.json")
const migratedAuthFile = path.join(Global.Path.data, "auth.json.migrated")
const globalConfigFile = path.join(Global.Path.config, "coderrupee.json")

const apiJson = { type: "api", key: "sk-test" } as const
const oauthJson = { type: "oauth", refresh: "refresh-token", access: "access-token", expires: 0 } as const

type MockState = {
  available: boolean
  entries: Map<string, string>
  setCalls: string[]
  failSetAccount?: string
  failList?: boolean
}

const state: MockState = {
  available: true,
  entries: new Map(),
  setCalls: [],
}

const fail = new Keyring.KeyringError({ message: "simulated keyring failure", backend: "linux-secret-tool" })

const mockKeyringLayer = Layer.mock(Keyring.Service)({
  backend: () => (state.available ? "linux-secret-tool" : "none"),
  isAvailable: () => Effect.succeed(state.available),
  get: (account) => Effect.succeed(state.entries.get(account)),
  set: (account, value) =>
    Effect.suspend(() => {
      if (state.failSetAccount === account) return Effect.fail(fail)
      state.setCalls.push(account)
      state.entries.set(account, value)
      return Effect.void
    }),
  delete: (account) =>
    Effect.sync(() => {
      state.entries.delete(account)
    }),
  list: () =>
    Effect.suspend(() => (state.failList ? Effect.fail(fail) : Effect.succeed(Object.fromEntries(state.entries)))),
})

const it = testEffect(LayerNode.compile(Auth.node, [[Keyring.node, mockKeyringLayer]]))

const writeAuthFile = (entries: Record<string, unknown>) =>
  Effect.promise(() =>
    fs.mkdir(path.dirname(authFile), { recursive: true }).then(() => fs.writeFile(authFile, JSON.stringify(entries), "utf8")),
  )

const writeGlobalConfig = (config: unknown) =>
  Effect.promise(() =>
    fs
      .mkdir(path.dirname(globalConfigFile), { recursive: true })
      .then(() => fs.writeFile(globalConfigFile, JSON.stringify(config), "utf8")),
  )

const expectAbsent = (target: string) =>
  Effect.promise(() =>
    fs
      .access(target)
      .then(
        () => Promise.reject(new Error(`expected ${path.basename(target)} to be absent`)),
        () => undefined,
      ),
  )

const expectPresent = (target: string) => Effect.promise(() => fs.access(target))

// A second Auth runtime over the same keyring mock, simulating a reload.
const secondRuntime = <A, E>(body: Effect.Effect<A, E, Auth.Service>) => {
  const layer = LayerNode.compile(Auth.node, [[Keyring.node, mockKeyringLayer]])
  return Effect.scoped(Effect.provide(body, layer))
}

describe("Auth keyring storage", () => {
  beforeEach(async () => {
    state.available = true
    state.entries.clear()
    state.setCalls = []
    state.failSetAccount = undefined
    state.failList = undefined
    await Promise.all([
      fs.rm(authFile, { force: true }),
      fs.rm(migratedAuthFile, { force: true }),
      fs.rm(globalConfigFile, { force: true }),
    ])
  })

  afterEach(async () => {
    await Promise.all([
      fs.rm(authFile, { force: true }),
      fs.rm(migratedAuthFile, { force: true }),
      fs.rm(globalConfigFile, { force: true }),
    ])
  })

  it.effect("auto mode migrates plaintext credentials into the keyring and renames auth.json", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson, "https://example.com": oauthJson })

      const all = yield* auth.all()

      expect(Object.keys(all).sort()).toEqual(["anthropic", "https://example.com"])
      expect(all.anthropic?.type).toBe("api")
      expect(all["https://example.com"]?.type).toBe("oauth")
      expect([...state.entries.keys()].sort()).toEqual(["anthropic", "https://example.com"])
      expect(JSON.parse(state.entries.get("anthropic")!)).toEqual(apiJson)
      expect([...state.setCalls].sort()).toEqual(["anthropic", "https://example.com"])
      yield* expectAbsent(authFile)
      yield* expectPresent(migratedAuthFile)
    }),
  )

  it.effect("migration is idempotent across reloads", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })
      yield* auth.all()
      expect(state.setCalls).toEqual(["anthropic"])

      yield* secondRuntime(
        Effect.gen(function* () {
          const reloaded = yield* Auth.Service
          const all = yield* reloaded.all()
          expect(Object.keys(all)).toEqual(["anthropic"])
        }),
      )
      // The reload must not rewrite credentials that are already stored.
      expect(state.setCalls).toEqual(["anthropic"])
      yield* expectAbsent(authFile)
    }),
  )

  it.effect("keyring unavailable falls back to plaintext", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })
      state.available = false

      const all = yield* auth.all()

      expect(all.anthropic?.type).toBe("api")
      expect(state.setCalls).toEqual([])
      yield* expectPresent(authFile)
      yield* expectAbsent(migratedAuthFile)
    }),
  )

  it.effect("auth.storage plaintext opts out of the keyring", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })
      yield* writeGlobalConfig({ auth: { storage: "plaintext" } })

      const all = yield* auth.all()

      expect(all.anthropic?.type).toBe("api")
      expect(state.setCalls).toEqual([])
      yield* expectPresent(authFile)
      yield* expectAbsent(migratedAuthFile)
    }),
  )

  it.effect("explicit keyring storage falls back to plaintext when no keyring exists", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })
      yield* writeGlobalConfig({ auth: { storage: "keyring" } })
      state.available = false

      const all = yield* auth.all()

      expect(all.anthropic?.type).toBe("api")
      expect(state.setCalls).toEqual([])
      yield* expectPresent(authFile)
    }),
  )

  it.effect("corrupt keyring entries are skipped and healthy entries survive", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      state.entries.set("healthy", JSON.stringify(apiJson))
      state.entries.set("not-json", "{oops")
      state.entries.set("wrong-shape", JSON.stringify({ type: "unknown-kind" }))

      const all = yield* auth.all()

      expect(Object.keys(all)).toEqual(["healthy"])
      expect(all.healthy?.type).toBe("api")
    }),
  )

  it.effect("failed migration keeps plaintext credentials readable", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson, openai: oauthJson })
      state.failSetAccount = "openai"

      const all = yield* auth.all()

      expect(all.anthropic?.type).toBe("api")
      expect(all.openai?.type).toBe("oauth")
      // plaintext stays authoritative on failure
      yield* expectPresent(authFile)
      yield* expectAbsent(migratedAuthFile)
      expect(state.setCalls).toEqual(["anthropic"])
    }),
  )

  it.effect("concurrent loads trigger a single migration", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })

      yield* Effect.forEach([1, 2, 3, 4, 5, 6], () => auth.all(), { concurrency: "unbounded", discard: true })

      expect(state.setCalls).toEqual(["anthropic"])
    }),
  )

  it.effect("keyring read failure falls back to the migrated plaintext copy", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* writeAuthFile({ anthropic: apiJson })
      expect((yield* auth.all()).anthropic?.type).toBe("api")
      yield* expectPresent(migratedAuthFile)

      state.failList = true
      const recovered = yield* auth.all()

      expect(recovered.anthropic?.type).toBe("api")
    }),
  )

  it.effect("set and remove route to the keyring in keyring mode", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", new Auth.Oauth(oauthJson))

      expect(JSON.parse(state.entries.get("anthropic")!)).toEqual(oauthJson)

      yield* auth.remove("anthropic")
      expect(state.entries.has("anthropic")).toBe(false)
    }),
  )
})
