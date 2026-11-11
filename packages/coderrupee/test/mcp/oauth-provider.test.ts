import { test, expect, describe } from "bun:test"
import { determineScope, auth } from "@modelcontextprotocol/sdk/client/auth.js"
import { TemporarilyUnavailableError } from "@modelcontextprotocol/sdk/server/auth/errors.js"
import { AppNodeBuilder } from "@coderrupee/core/effect/app-node-builder"
import { memoMap } from "@coderrupee/core/effect/memo-map"
import { Context, Effect, Layer } from "effect"
import type { Scope } from "effect"
import { FSUtil } from "@coderrupee/core/fs-util"
import { McpOAuthProvider, OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH } from "../../src/mcp/oauth-provider"
import { McpAuth } from "../../src/mcp/auth"
import type { McpAuth as McpAuthType } from "../../src/mcp/auth"
import { testEffect } from "../lib/effect"

// Stub auth — only synchronous getters are exercised in these tests
const stubAuth = {} as McpAuthType.Interface

const makeProvider = (config: ConstructorParameters<typeof McpOAuthProvider>[2]) =>
  new McpOAuthProvider("test-server", "https://mcp.example.com/mcp", config, { onRedirect: async () => {} }, stubAuth)

describe("McpOAuthProvider.redirectUrl", () => {
  test("defaults to 127.0.0.1:19876/mcp/oauth/callback", () => {
    const provider = makeProvider({})
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  })

  test("uses callbackPort when set", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`)
  })

  test("redirectUri takes precedence over callbackPort", () => {
    const provider = makeProvider({
      callbackPort: 6620,
      redirectUri: "http://127.0.0.1:9999/custom/callback",
    })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:9999/custom/callback")
  })

  test("uses explicit redirectUri when set without callbackPort", () => {
    const provider = makeProvider({ redirectUri: "http://127.0.0.1:8080/oauth/callback" })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:8080/oauth/callback")
  })
})

describe("McpOAuthProvider.redirectToAuthorization", () => {
  test("forwards http and https authorization URLs", async () => {
    const seen: string[] = []
    const provider = new McpOAuthProvider(
      "test-server",
      "https://mcp.example.com/mcp",
      {},
      { onRedirect: (url) => void seen.push(url.href) },
      stubAuth,
    )
    await provider.redirectToAuthorization(new URL("https://auth.example.com/authorize?state=1"))
    await provider.redirectToAuthorization(new URL("http://127.0.0.1:8080/authorize"))
    expect(seen).toEqual(["https://auth.example.com/authorize?state=1", "http://127.0.0.1:8080/authorize"])
  })

  test("rejects authorization URLs that are not http or https", async () => {
    const seen: string[] = []
    const provider = new McpOAuthProvider(
      "test-server",
      "https://mcp.example.com/mcp",
      {},
      { onRedirect: (url) => void seen.push(url.href) },
      stubAuth,
    )
    await expect(provider.redirectToAuthorization(new URL("file:///tmp/authorize"))).rejects.toThrow(
      "returned a file: authorization URL",
    )
    expect(seen).toEqual([])
  })
})

describe("McpOAuthProvider.clientMetadata", () => {
  test("includes redirect_uris from redirectUrl", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.clientMetadata.redirect_uris).toEqual([`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`])
  })

  test("includes scope when set in config", () => {
    const provider = makeProvider({ scope: "openid offline_access" })
    expect(provider.clientMetadata.scope).toBe("openid offline_access")
  })

  test("omits scope when not set in config", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.scope).toBeUndefined()
  })

  test("sets token_endpoint_auth_method to client_secret_post when clientSecret provided", () => {
    const provider = makeProvider({ clientSecret: "secret" })
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post")
  })

  test("sets token_endpoint_auth_method to none when no clientSecret", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none")
  })
})

describe("MCP OAuth scope selection", () => {
  test("adds offline_access when the authorization server and client support refresh tokens", () => {
    expect(
      determineScope({
        resourceMetadata: {
          resource: "https://mcp.example.com/mcp",
          scopes_supported: ["resource.read"],
        },
        authServerMetadata: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          response_types_supported: ["code"],
          scopes_supported: ["resource.read", "offline_access"],
        },
        clientMetadata: makeProvider({}).clientMetadata,
      }),
    ).toBe("resource.read offline_access")
  })

  test("does not add unsupported authorization server scopes", () => {
    expect(
      determineScope({
        resourceMetadata: {
          resource: "https://mcp.example.com/mcp",
          scopes_supported: ["resource.read"],
        },
        authServerMetadata: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          response_types_supported: ["code"],
          scopes_supported: ["resource.read"],
        },
        clientMetadata: makeProvider({}).clientMetadata,
      }),
    ).toBe("resource.read")
  })
})

// ---------------------------------------------------------------------------
// Credential robustness — stale snapshots must not destroy rotated credentials,
// refreshes coordinate across connections and processes, transient refresh
// failures keep the stored credential.
// ---------------------------------------------------------------------------

const SERVER_URL = "https://mcp.example.com/mcp"

type Raw = { current: Record<string, unknown> | undefined }

// In-memory mcp-auth.json behind the real McpAuth service, so provider code runs against the real
// read/merge/clear semantics and the real cross-process flock without touching user data.
const memoryFsLayer = (raw: Raw) =>
  Layer.effect(
    FSUtil.Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      return FSUtil.Service.of({
        ...fs,
        readJson: (file) =>
          file.endsWith("mcp-auth.json")
            ? raw.current === undefined
              ? Effect.fail(new FSUtil.FileSystemError({ method: "readJson", cause: new Error("mcp-auth.json missing") }))
              : Effect.succeed(raw.current)
            : fs.readJson(file),
        writeJson: (file, value, mode) =>
          file.endsWith("mcp-auth.json")
            ? Effect.sync(() => {
                raw.current = value as Record<string, unknown>
              })
            : fs.writeJson(file, value, mode),
      })
    }),
  ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))

// Builds into the caller's scope so the service stays alive for the whole test — withRefreshLock
// forks refresh operations into the layer scope, which must outlive the test body's fibers.
const buildAuth = (scope: Scope.Scope, raw: Raw) =>
  Effect.gen(function* () {
    const context = yield* Layer.buildWithMemoMap(
      AppNodeBuilder.build(McpAuth.node, [[FSUtil.node, memoryFsLayer(raw)]]),
      memoMap,
      scope,
    )
    return Context.get(context, McpAuth.Service)
  })

function authProvider(auth: McpAuth.Interface, serverUrl = SERVER_URL, mcpName = "test-server") {
  return new McpOAuthProvider(
    mcpName,
    serverUrl,
    { clientId: "client", clientSecret: "secret" },
    { onRedirect: async () => {} },
    auth,
  )
}

const seedTokens = (auth: McpAuth.Interface, serverUrl: string, tokens: McpAuth.Tokens, mcpName = "test-server") =>
  auth.set(mcpName, { tokens }, serverUrl)

const storedTokens = (auth: McpAuth.Interface, serverUrl: string, mcpName = "test-server") =>
  Effect.gen(function* () {
    return (yield* auth.getForUrl(mcpName, serverUrl))?.tokens
  })

const refreshCall = (fetchFn: ReturnType<McpOAuthProvider["refreshFetch"]>, url: string, refresh: string) =>
  fetchFn(url, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }) })

const it = testEffect(Layer.empty)

describe("McpOAuthProvider stale credential protection", () => {
  it.live("does not clobber tokens another connection rotated past the one it presented", () =>
    Effect.gen(function* () {
      const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
      const provider = authProvider(auth)
      yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" })
      yield* Effect.promise(() => provider.tokens())
      yield* auth.updateTokens("test-server", { accessToken: "a-x", refreshToken: "r2" }, SERVER_URL)

      // The SDK echoes back the refresh token it presented, as refreshAuthorization preserves it.
      yield* Effect.promise(() => provider.saveTokens({ access_token: "a1", token_type: "Bearer", refresh_token: "r1" }))

      expect(yield* storedTokens(auth, SERVER_URL)).toEqual({ accessToken: "a-x", refreshToken: "r2" })
    }),
  )

  it.live("saves normally when the stored token is still the one it presented", () =>
    Effect.gen(function* () {
      const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
      const provider = authProvider(auth)
      yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r2" })
      yield* Effect.promise(() => provider.tokens())

      yield* Effect.promise(() =>
        provider.saveTokens({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 }),
      )

      const tokens = yield* storedTokens(auth, SERVER_URL)
      expect(tokens?.accessToken).toBe("a2")
      expect(tokens?.refreshToken).toBe("r2")
      expect(tokens?.expiresAt).toBeGreaterThan(Date.now() / 1000)
    }),
  )

  it.live("keeps rotated tokens when the SDK invalidates a stale snapshot", () =>
    Effect.gen(function* () {
      const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
      const provider = authProvider(auth)
      yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" })
      yield* Effect.promise(() => provider.tokens())
      yield* auth.updateTokens("test-server", { accessToken: "a-x", refreshToken: "r2" }, SERVER_URL)

      yield* Effect.promise(() => provider.invalidateCredentials("tokens"))

      expect(yield* storedTokens(auth, SERVER_URL)).toEqual({ accessToken: "a-x", refreshToken: "r2" })
    }),
  )

  it.live("clears tokens when the stored refresh token is still the rejected one", () =>
    Effect.gen(function* () {
      const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
      const provider = authProvider(auth)
      yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" })
      yield* Effect.promise(() => provider.tokens())

      yield* Effect.promise(() => provider.invalidateCredentials("tokens"))

      expect(yield* storedTokens(auth, SERVER_URL)).toBeUndefined()
    }),
  )

  it.live("sign-out clears client info but still protects rotated tokens", () =>
    Effect.gen(function* () {
      const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
      const provider = authProvider(auth)
      yield* auth.set(
        "test-server",
        { tokens: { accessToken: "a1", refreshToken: "r1" }, clientInfo: { clientId: "c1" } },
        SERVER_URL,
      )
      yield* Effect.promise(() => provider.tokens())
      yield* auth.updateTokens("test-server", { accessToken: "a-x", refreshToken: "r2" }, SERVER_URL)

      yield* Effect.promise(() => provider.invalidateCredentials("all"))

      const entry = yield* auth.getForUrl("test-server", SERVER_URL)
      expect(entry?.tokens).toEqual({ accessToken: "a-x", refreshToken: "r2" })
      expect(entry?.clientInfo).toBeUndefined()
    }),
  )
})

describe("McpOAuthProvider locked refresh", () => {
  it.live("shares one refresh across concurrent callers of the same server", () =>
    Effect.gen(function* () {
      const received = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const sent: string[] = []
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
          sent.push(new URLSearchParams(await request.text()).get("refresh_token") ?? "")
          received.resolve()
          await release.promise
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        },
      })
      return Effect.gen(function* () {
        const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
        const fetchA = authProvider(auth, SERVER_URL, "shared").refreshFetch()
        const fetchB = authProvider(auth, SERVER_URL, "shared").refreshFetch()
        yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" }, "shared")

        const responses = yield* Effect.promise(async () => {
          const pendingA = refreshCall(fetchA, `${server.url.origin}/token`, "r1")
          await received.promise
          const pendingB = refreshCall(fetchB, `${server.url.origin}/token`, "r1")
          release.resolve()
          return Promise.all([pendingA, pendingB])
        })
        const [resA, resB] = responses

        expect(sent).toEqual(["r1"])
        expect(resA.status).toBe(200)
        expect(yield* Effect.promise(() => resA.json())).toMatchObject({ refresh_token: "r2" })
        expect(resB.status).toBe(200)
        expect(yield* Effect.promise(() => resB.json())).toMatchObject({ refresh_token: "r2" })
        expect((yield* storedTokens(auth, SERVER_URL, "shared"))?.refreshToken).toBe("r2")
      }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))))
    }),
  )

  it.live("rejects a stale refresh without a second request once another instance rotated the token", () =>
    Effect.gen(function* () {
      const received = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const sent: string[] = []
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
          sent.push(new URLSearchParams(await request.text()).get("refresh_token") ?? "")
          received.resolve()
          await release.promise
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        },
      })
      return Effect.gen(function* () {
        const raw = { current: undefined as Record<string, unknown> | undefined }
        const scope = yield* Effect.scope
        const authA = yield* buildAuth(scope, raw)
        const authB = yield* buildAuth(scope, raw)
        expect(authA).not.toBe(authB)
        const fetchA = authProvider(authA, SERVER_URL, "cross").refreshFetch()
        const fetchB = authProvider(authB, SERVER_URL, "cross").refreshFetch()
        yield* seedTokens(authA, SERVER_URL, { accessToken: "a1", refreshToken: "r1" }, "cross")

        const responses = yield* Effect.promise(async () => {
          const pendingA = refreshCall(fetchA, `${server.url.origin}/token`, "r1")
          await received.promise
          const pendingB = refreshCall(fetchB, `${server.url.origin}/token`, "r1")
          release.resolve()
          return Promise.all([pendingA, pendingB])
        })
        const [resA, resB] = responses

        expect(sent).toEqual(["r1"])
        expect(resA.status).toBe(200)
        expect(resB.status).toBe(400)
        expect(yield* Effect.promise(() => resB.json())).toMatchObject({ error: "invalid_grant" })
        expect((yield* storedTokens(authB, SERVER_URL, "cross"))?.refreshToken).toBe("r2")
      }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))))
    }),
  )

  it.live("answers temporarily_unavailable and keeps the credential when the token endpoint answers 503", () =>
    Effect.gen(function* () {
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response("upstream unavailable", { status: 503 }),
      })
      return Effect.gen(function* () {
        const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
        const fetchFn = authProvider(auth, SERVER_URL, "failing").refreshFetch()
        yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" }, "failing")

        const response = yield* Effect.promise(() => refreshCall(fetchFn, `${server.url.origin}/token`, "r1"))

        expect(response.status).toBe(503)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ error: "temporarily_unavailable" })
        expect(yield* storedTokens(auth, SERVER_URL, "failing")).toEqual({ accessToken: "a1", refreshToken: "r1" })
      }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))))
    }),
  )

  it.live("answers temporarily_unavailable and keeps the credential when the token endpoint is unreachable", () =>
    Effect.gen(function* () {
      const closed = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
      const deadUrl = `${closed.url.origin}/token`
      closed.stop(true)

      return Effect.gen(function* () {
        const auth = yield* buildAuth(yield* Effect.scope, { current: undefined })
        const fetchFn = authProvider(auth, SERVER_URL, "failing").refreshFetch()
        yield* seedTokens(auth, SERVER_URL, { accessToken: "a1", refreshToken: "r1" }, "failing")

        const response = yield* Effect.promise(() => refreshCall(fetchFn, deadUrl, "r1"))

        expect(response.status).toBe(503)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ error: "temporarily_unavailable" })
        expect(yield* storedTokens(auth, SERVER_URL, "failing")).toEqual({ accessToken: "a1", refreshToken: "r1" })
      })
    }),
  )
})

describe("McpOAuthProvider SDK auth flows", () => {
  it.live("fails without signing out when the token endpoint is unavailable, then recovers", () =>
    Effect.gen(function* () {
      const state = { mode: "unavailable" as "unavailable" | "ok", sent: [] as Array<string | null> }
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/.well-known/oauth-authorization-server")
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              response_types_supported: ["code"],
            })
          if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
          state.sent.push(new URLSearchParams(await request.text()).get("refresh_token"))
          if (state.mode === "unavailable") return new Response("upstream unavailable", { status: 503 })
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        },
      })
      return Effect.gen(function* () {
        const serverUrl = `${server.url.origin}/mcp`
        const authService = yield* buildAuth(yield* Effect.scope, { current: undefined })
        const provider = authProvider(authService, serverUrl, "sdk")
        yield* seedTokens(authService, serverUrl, { accessToken: "a1", refreshToken: "r1" }, "sdk")

        const failure = yield* Effect.promise(() =>
          auth(provider, { serverUrl, fetchFn: provider.refreshFetch() }).then(
            () => null,
            (error: unknown) => error,
          ),
        )
        expect(failure).toBeInstanceOf(TemporarilyUnavailableError)
        expect(yield* storedTokens(authService, serverUrl, "sdk")).toEqual({ accessToken: "a1", refreshToken: "r1" })

        state.mode = "ok"
        const result = yield* Effect.promise(() => auth(provider, { serverUrl, fetchFn: provider.refreshFetch() }))
        expect(result).toBe("AUTHORIZED")
        expect(yield* storedTokens(authService, serverUrl, "sdk")).toEqual({
          accessToken: "a2",
          refreshToken: "r2",
          expiresAt: expect.any(Number),
        })
        // The retry spent the same refresh token again instead of starting a new authorization.
        expect(state.sent).toEqual(["r1", "r1"])
      }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))))
    }),
  )

  it.live("reloads rotated tokens instead of signing out when another connection refreshed first", () =>
    Effect.gen(function* () {
      const state = {
        mode: "race" as "race" | "ok",
        sent: [] as Array<string | null>,
        onFirstR1: undefined as undefined | (() => Promise<void>),
      }
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/.well-known/oauth-authorization-server")
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              response_types_supported: ["code"],
            })
          if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
          const token = new URLSearchParams(await request.text()).get("refresh_token") ?? ""
          state.sent.push(token)
          if (token === "r1" && state.onFirstR1) {
            const simulate = state.onFirstR1
            state.onFirstR1 = undefined
            await simulate()
            return Response.json({ error: "invalid_grant" }, { status: 400 })
          }
          if (state.mode === "race" && token === "r1") return Response.json({ error: "invalid_grant" }, { status: 400 })
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        },
      })
      return Effect.gen(function* () {
        const serverUrl = `${server.url.origin}/mcp`
        const raw = { current: undefined as Record<string, unknown> | undefined }
        const authService = yield* buildAuth(yield* Effect.scope, raw)
        const provider = authProvider(authService, serverUrl, "sdk-race")
        yield* seedTokens(authService, serverUrl, { accessToken: "a1", refreshToken: "r1" }, "sdk-race")
        // While the refresh is in flight, a concurrent connection refreshes r1 into r2 and saves it.
        state.onFirstR1 = () =>
          Effect.runPromise(authService.updateTokens("sdk-race", { accessToken: "a-x", refreshToken: "r2" }, serverUrl))

        const result = yield* Effect.promise(() => auth(provider, { serverUrl, fetchFn: provider.refreshFetch() }))

        expect(result).toBe("AUTHORIZED")
        expect(state.sent).toEqual(["r1", "r2"])
        expect(yield* storedTokens(authService, serverUrl, "sdk-race")).toEqual({
          accessToken: "a2",
          refreshToken: "r2",
          expiresAt: expect.any(Number),
        })
      }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))))
    }),
  )
})

