import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { AppNodeBuilder } from "@coderrupee/core/effect/app-node-builder"
import { httpClient } from "@coderrupee/core/effect/app-node-platform"
import { Effect, Layer, Schema, Context, Stream } from "effect"
import { serviceUse } from "@coderrupee/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@coderrupee/core/process"
import path from "path"
import { makeRuntime } from "@coderrupee/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@coderrupee/core/installation/version"
import { NpmConfig } from "@coderrupee/core/npm-config"
import { InstallationEvent } from "@coderrupee/schema/installation-event"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `coderrupee/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// CoderRupee only updates within its own major version, so package sources that don't carry the
// installed major must not be reported as a normal update.
export function isUpdate(current: string, latest: string) {
  if (!semver.valid(latest)) return false
  if (!semver.valid(current)) return semver.major(latest) === 1
  return semver.major(latest) === semver.major(current) && semver.gt(latest, current)
}

// Every install method discovers 1.x releases from npm. npm is published before the GitHub release.
// Preview builds follow their own dist-tag, source builds follow latest.
const NPM_TAG = InstallationChannel === "local" ? "latest" : InstallationChannel

// Update channels map onto npm dist-tags: stable follows the latest release, beta follows the beta tag.
// Anything unknown falls back to latest so a bad config value can't hide updates.
export function distTag(channel: string | undefined) {
  if (channel === "beta") return "beta"
  return "latest"
}

// Response schemas for external version APIs
const NpmPackage = Schema.Struct({ version: Schema.String })
const BrewInfoV2 = Schema.Struct({
  formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
})
const ChocoPackage = Schema.Struct({
  d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
})

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method, channel?: string) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@coderrupee/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
    const appProcess = yield* AppProcess.Service

    const text = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return result.stdout.toString("utf8")
      },
      Effect.catch(() => Effect.succeed("")),
    )

    const run = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.catch((err) => Effect.succeed({ code: 1, stdout: "", stderr: errorMessage(err) })),
    )

    const getBrewFormula = Effect.fnUntraced(function* () {
      const tapFormula = yield* text(["brew", "list", "--formula", "nareinnprs-create/tap/coderrupee"])
      if (tapFormula.includes("coderrupee")) return "nareinnprs-create/tap/coderrupee"
      const coreFormula = yield* text(["brew", "list", "--formula", "coderrupee"])
      if (coreFormula.includes("coderrupee")) return "coderrupee"
      return "coderrupee"
    })

    const upgradeFailure = (method: Method, result?: { code: number; stdout: string; stderr: string }) => {
      if (method === "choco") return "not running from an elevated command shell"
      if (result) return `Upgrade failed for ${method} (exit code ${result.code}).`
      return `Upgrade failed for ${method}.`
    }

    const upgradeScriptShell = Effect.fnUntraced(function* () {
      const bashVersion = yield* text(["bash", "--version"])
      if (bashVersion) return "bash"
      return "sh"
    })

    const upgradeCurl = Effect.fnUntraced(
      function* (target: string) {
        const response = yield* httpOk.execute(HttpClientRequest.get("https://coderrupee.opraiz.com/install"))
        const body = yield* response.text
        const bodyBytes = new TextEncoder().encode(body)
        const shell = yield* upgradeScriptShell()
        const result = yield* appProcess.run(
          ChildProcess.make(shell, [], {
            stdin: Stream.make(bodyBytes),
            env: { VERSION: target },
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
    )

    const npmLatest = Effect.fnUntraced(function* (tag: string) {
      const response = yield* httpOk.execute(
        HttpClientRequest.get(`${yield* NpmConfig.registry(process.cwd())}/coderrupee-ai/${tag}`).pipe(
          HttpClientRequest.acceptJson,
        ),
      )
      const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
      return data.version
    })

    // Secondary update source for when the npm registry lookup fails (registry outage, mirrorless
    // offline CI, or the package not being published yet).
    const GithubRelease = Schema.Struct({ tag_name: Schema.String })

    const githubLatest = Effect.fnUntraced(function* () {
      const response = yield* httpOk.execute(
        HttpClientRequest.get("https://api.github.com/repos/nareinnprs-create/coderrupee/releases/latest").pipe(
          HttpClientRequest.acceptJson,
        ),
      )
      const data = yield* HttpClientResponse.schemaBodyJson(GithubRelease)(response)
      return data.tag_name.replace(/^v/, "")
    })

    // Chocolatey can only install versions its moderated community feed has published.
    const chocoHas = Effect.fnUntraced(function* (version: string) {
      const response = yield* httpOk.execute(
        HttpClientRequest.get(
          `https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27coderrupee%27%20and%20Version%20eq%20%27${encodeURIComponent(version)}%27&$select=Version`,
        ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
      )
      const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
      return data.d.results.length > 0
    })

    const tapVersion = Effect.fnUntraced(
      function* (formula: string) {
        const infoJson = yield* text(["brew", "info", "--json=v2", formula])
        const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
        return info.formulae[0].versions.stable
      },
      Effect.orElseSucceed(() => undefined),
    )


    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".coderrupee", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        const exec = process.execPath.toLowerCase()

        const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
          { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
          { name: "yarn", command: () => text(["yarn", "global", "list"]) },
          { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
          { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
          { name: "brew", command: () => text(["brew", "list", "--formula", "coderrupee"]) },
          { name: "scoop", command: () => text(["scoop", "list", "coderrupee"]) },
          { name: "choco", command: () => text(["choco", "list", "--limit-output", "coderrupee"]) },
        ]

        checks.sort((a, b) => {
          const aMatches = exec.includes(a.name)
          const bMatches = exec.includes(b.name)
          if (aMatches && !bMatches) return -1
          if (!aMatches && bMatches) return 1
          return 0
        })

        for (const check of checks) {
          const output = yield* check.command()
          const installedName =
            check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "coderrupee" : "coderrupee-ai"
          if (output.includes(installedName)) {
            return check.name
          }
        }

        return "unknown" as Method
      }),
      // Reports the installed version when there's no deliverable 1.x update for this install method.
      latest: Effect.fn("Installation.latest")(function* (installMethod?: Method, channel?: string) {
        const method = installMethod || (yield* result.method())
        // A Homebrew Core install has no 1.x formula source, so `brew upgrade` can't deliver an update.
        if (method === "brew" && !(yield* getBrewFormula()).includes("/")) return InstallationVersion
        return yield* Effect.gen(function* () {
          const found = yield* npmLatest(channel ? distTag(channel) : NPM_TAG).pipe(
            Effect.catch(() => githubLatest()),
          )
          if (!isUpdate(InstallationVersion, found)) return InstallationVersion
          if (method === "choco" && !(yield* chocoHas(found))) return InstallationVersion
          return found
        }).pipe(Effect.timeout("10 seconds"))
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
        let upgradeResult: { code: number; stdout: string; stderr: string } | undefined
        switch (m) {
          case "curl":
            upgradeResult = yield* upgradeCurl(target)
            break
          case "npm":
            upgradeResult = yield* run(["npm", "install", "-g", `coderrupee-ai@${target}`])
            break
          case "pnpm":
            upgradeResult = yield* run(["pnpm", "install", "-g", `coderrupee-ai@${target}`])
            break
          case "bun":
            upgradeResult = yield* run(["bun", "install", "-g", `coderrupee-ai@${target}`])
            break
          case "yarn":
            upgradeResult = yield* run(["yarn", "global", "add", `coderrupee-ai@${target}`])
            break
          case "brew": {
            const formula = yield* getBrewFormula()
            const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
            if (!formula.includes("/"))
              return yield* new UpgradeFailedError({
                stderr:
                  "Homebrew tap not published yet: nareinnprs-create/tap does not exist, so brew can't install or upgrade CoderRupee. Use the install script (https://coderrupee.opraiz.com/install) or npm instead.",
              })
            const tap = yield* run(["brew", "tap", "nareinnprs-create/tap"], { env })
            if (tap.code !== 0) {
              upgradeResult = tap
              break
            }
            const repo = yield* text(["brew", "--repo", "nareinnprs-create/tap"])
            const dir = repo.trim()
            if (dir) {
              const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
              if (pull.code !== 0) {
                upgradeResult = pull
                break
              }
            }
            // The tap is updated shortly after npm, so a just-published release may not be installable yet.
            const available = yield* tapVersion(formula)
            if (!available || semver.major(available) !== semver.major(target) || semver.lt(available, target))
              return yield* new UpgradeFailedError({
                stderr: `Homebrew can't install CoderRupee ${target} yet: ${formula} is at ${available ?? "an unknown version"}. Try again in a few minutes.`,
              })
            upgradeResult = yield* run(["brew", "upgrade", formula], { env })
            break
          }
          case "choco": {
            // The community feed has no coderrupee package yet; fail with a clear message instead
            // of choco's misleading elevation error.
            const available = yield* chocoHas(target).pipe(Effect.catch(() => Effect.succeed(false)))
            if (!available)
              return yield* new UpgradeFailedError({
                stderr:
                  "Chocolatey package not published yet: coderrupee is not in the Chocolatey community feed, so choco can't install or upgrade it. Use the install script (https://coderrupee.opraiz.com/install) or npm instead.",
              })
            upgradeResult = yield* run(["choco", "upgrade", "coderrupee", `--version=${target}`, "-y"])
            break
          }
          case "scoop":
            // No coderrupee manifest exists in any Scoop bucket, so this path can never succeed yet.
            return yield* new UpgradeFailedError({
              stderr:
                "Scoop manifest not published yet: no coderrupee manifest exists in any known Scoop bucket, so scoop can't install or upgrade it. Use the install script (https://coderrupee.opraiz.com/install) or npm instead.",
            })
          default:
            return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}` })
        }
        if (!upgradeResult || upgradeResult.code !== 0) {
          return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, upgradeResult) })
        }
        yield* Effect.logInfo("upgraded", {
          method: m,
          target,
          stdout: upgradeResult.stdout,
          stderr: upgradeResult.stderr,
        })
        yield* text([process.execPath, "--version"])
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient, AppProcess.node] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
