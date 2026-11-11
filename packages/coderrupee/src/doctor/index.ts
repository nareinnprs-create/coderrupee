export * as Doctor from "."

import { Cause, Effect, Exit, Schema, SchemaIssue } from "effect"
import { spawn } from "node:child_process"
import fs from "fs/promises"
import { existsSync } from "node:fs"
import path from "path"
import { printParseErrorCode, parse } from "jsonc-parser"
import type { ParseError } from "jsonc-parser"
import type { Installation } from "@/installation"
import { Global } from "@coderrupee/core/global"
import { InstallationChannel, InstallationVersion } from "@coderrupee/core/installation/version"
import { errorMessage } from "@/util/error"

export type Status = "pass" | "warn" | "fail" | "info"

export interface CheckResult {
  readonly id: string
  readonly label: string
  readonly status: Status
  readonly detail?: string
  readonly hint?: string
}

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface StoragePaths {
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
}

/**
 * Everything a check touches is injected, so checks are pure consumers of the
 * platform and can be exercised with a fully mocked context in tests. No check
 * performs a network request; `detectMethod` only asks local package managers.
 */
export interface DoctorContext {
  readonly cwd: string
  readonly execPath: string
  readonly version: string
  readonly channel: string
  readonly paths: StoragePaths
  readonly runCommand: (file: string, args: string[], opts?: { cwd?: string }) => Promise<CommandResult>
  readonly exists: (file: string) => Promise<boolean>
  readonly readFile: (file: string) => Promise<string>
  readonly accessWritable: (dir: string) => Promise<boolean>
  readonly statfs: (dir: string) => Promise<{ bsize: number; bavail: number } | undefined>
  readonly detectMethod: () => Promise<Installation.Method>
  readonly keyring?: {
    readonly backend: string
    readonly list: () => Promise<Record<string, string>>
  }
}

export interface Check {
  readonly id: string
  readonly label: string
  readonly run: (ctx: DoctorContext) => Promise<CheckResult>
}

export function defaultContext(cwd = process.cwd()): DoctorContext {
  return {
    cwd,
    execPath: process.execPath,
    version: InstallationVersion,
    channel: InstallationChannel,
    paths: {
      data: Global.Path.data,
      cache: Global.Path.cache,
      config: Global.Path.config,
      state: Global.Path.state,
    },
    runCommand: async (file, args, opts) => {
      try {
        // node:child_process works under both Bun and Node (desktop sidecar).
        const proc = spawn(file, args, {
          cwd: opts?.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        })
        const read = (stream: NodeJS.ReadableStream | null) =>
          new Promise<string>((resolve) => {
            let out = ""
            if (!stream) return resolve(out)
            stream.on("data", (chunk) => (out += chunk.toString()))
            stream.on("end", () => resolve(out))
            stream.on("error", () => resolve(out))
          })
        const [stdout, stderr, code] = await Promise.all([
          read(proc.stdout),
          read(proc.stderr),
          new Promise<number>((resolve) => proc.on("close", (c) => resolve(c ?? -1))),
        ])
        return { code, stdout, stderr }
      } catch (err) {
        return { code: -1, stdout: "", stderr: errorMessage(err) }
      }
    },
    exists: async (file) => existsSync(file),
    readFile: (file) => fs.readFile(file, "utf8"),
    accessWritable: async (dir) => {
      try {
        await fs.access(dir, fs.constants.W_OK)
        return true
      } catch {
        return false
      }
    },
    statfs: async (dir) => {
      try {
        const stats = await fs.statfs(dir)
        return { bsize: stats.bsize, bavail: stats.bavail }
      } catch {
        return undefined
      }
    },
    detectMethod: async () => {
      const { Installation } = await import("@/installation")
      return Installation.method()
    },
  }
}

export async function defaultKeyring() {
  try {
    const { AppNodeBuilder } = await import("@coderrupee/core/effect/app-node-builder")
    const { makeRuntime } = await import("@coderrupee/core/effect/runtime")
    const { Keyring } = await import("@/auth/keyring")
    const runtime = makeRuntime(Keyring.Service, AppNodeBuilder.build(Keyring.node))
    return {
      backend: runtime.runSync((service) => Effect.succeed(service.backend())),
      list: () => runtime.runPromise((service) => service.list()),
    }
  } catch {
    return undefined
  }
}

export const installationCheck: Check = {
  id: "installation",
  label: "Installation",
  async run(ctx) {
    let method: Installation.Method
    try {
      method = await ctx.detectMethod()
    } catch (err) {
      return { id: this.id, label: this.label, status: "info", detail: `version ${ctx.version}, channel ${ctx.channel} (install method could not be detected: ${errorMessage(err)})` }
    }
    if (method === "unknown")
      return {
        id: this.id,
        label: this.label,
        status: "info",
        detail: `version ${ctx.version}, channel ${ctx.channel}, install method unknown`,
        hint: "install with a supported package manager so `coderrupee upgrade` can update in place",
      }
    if (ctx.channel === "local")
      return {
        id: this.id,
        label: this.label,
        status: "info",
        detail: `version ${ctx.version} from a local build, detected install method ${method}`,
      }
    return {
      id: this.id,
      label: this.label,
      status: "pass",
      detail: `version ${ctx.version} via ${method} (${ctx.channel} channel)`,
    }
  },
}

export const runtimeCheck: Check = {
  id: "runtime",
  label: "Runtime",
  async run(ctx) {
    const [bun, node] = await Promise.all([ctx.runCommand("bun", ["--version"]), ctx.runCommand("node", ["--version"])])
    const parts = [
      ...(bun.code === 0 ? [`bun ${firstLine(bun.stdout)}`] : []),
      ...(node.code === 0 ? [`node ${firstLine(node.stdout)}`] : []),
    ]
    if (parts.length === 0)
      return { id: this.id, label: this.label, status: "info", detail: "no bun or node runtime found on PATH" }
    return { id: this.id, label: this.label, status: "pass", detail: parts.join(", ") }
  },
}

export const authCheck: Check = {
  id: "auth",
  label: "Auth",
  async run(ctx) {
    const file = path.join(ctx.paths.data, "auth.json")
    const envContent = process.env.CODERRUPEE_AUTH_CONTENT
    if (envContent !== undefined) {
      const parsed = parseAuthEntries(envContent)
      if (!parsed)
        return {
          id: this.id,
          label: this.label,
          status: "warn",
          detail: "CODERRUPEE_AUTH_CONTENT is set but is not valid JSON; its content is ignored",
        }
      return summarizeAuth(parsed, `CODERRUPEE_AUTH_CONTENT environment variable (file ${file} unused)`, this.id, this.label)
    }
    if (ctx.keyring && ctx.keyring.backend !== "none") {
      const stored = await ctx.keyring.list()
      const entries = Object.entries(stored).map(([key, value]) => {
        try {
          return [key, JSON.parse(value)] as [string, unknown]
        } catch {
          return [key, value] as [string, unknown]
        }
      })
      return summarizeAuth(entries, `${ctx.keyring.backend} keyring`, this.id, this.label)
    }
    if (!(await ctx.exists(file)))
      return {
        id: this.id,
        label: this.label,
        status: "info",
        detail: `no credentials stored at ${file}`,
      }
    const text = await ctx.readFile(file)
    const parsed = parseAuthEntries(text)
    if (!parsed)
      return {
        id: this.id,
        label: this.label,
        status: "warn",
        detail: `${file} is not valid JSON; credentials will be ignored`,
        hint: "back up the file and re-authenticate to repair it",
      }
    return summarizeAuth(parsed, file, this.id, this.label)
  },
}

export const configCheck: Check = {
  id: "config",
  label: "Config",
  async run(ctx) {
    // Same candidate order as the global config loader in src/config/config.ts.
    const candidates = ["coderrupee.jsonc", "coderrupee.json", "config.json"].map((name) =>
      path.join(ctx.paths.config, name),
    )
    let file: string | undefined
    for (const candidate of candidates) {
      if (await ctx.exists(candidate)) {
        file = candidate
        break
      }
    }
    if (!file)
      return { id: this.id, label: this.label, status: "info", detail: `no config file in ${ctx.paths.config} (defaults in use)` }

    const text = await ctx.readFile(file)
    const parsed = parseJsoncCompact(text)
    if (parsed.errors.length > 0)
      return {
        id: this.id,
        label: this.label,
        status: "fail",
        detail: `${file}: ${parsed.errors.join("; ")}`,
        hint: "fix the syntax error so the config can load; this check does not modify the file",
      }

    const { ConfigV2Compat } = await import("@/config/v2-compat")
    const lowered = ConfigV2Compat.lower(parsed.data, file)
    const issues = await schemaIssues(lowered.value)
    if (issues.length > 0)
      return {
        id: this.id,
        label: this.label,
        status: "fail",
        detail: `${file}: ${issues.join("; ")}`,
        hint: "fix the rejected value so the config can load; this check does not modify the file",
      }
    if (lowered.diagnostics.length > 0)
      return {
        id: this.id,
        label: this.label,
        status: "pass",
        detail: `${file} valid (${lowered.diagnostics.length} compatibility rewrite(s) applied)`,
      }
    return { id: this.id, label: this.label, status: "pass", detail: `${file} valid` }
  },
}

export const projectCheck: Check = {
  id: "project",
  label: "Project",
  async run(ctx) {
    const inside = await ctx.runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ctx.cwd })
    if (inside.code !== 0 || inside.stdout.trim() !== "true")
      return { id: this.id, label: this.label, status: "info", detail: `${ctx.cwd} is not inside a git repository` }
    const branchOut = await ctx.runCommand("git", ["branch", "--show-current"], { cwd: ctx.cwd })
    const statusOut = await ctx.runCommand("git", ["status", "--porcelain"], { cwd: ctx.cwd })
    const branch = firstLine(branchOut.stdout) || "detached HEAD"
    const dirty = statusOut.stdout.split("\n").filter((line) => line.trim() !== "").length
    if (dirty === 0) return { id: this.id, label: this.label, status: "pass", detail: `branch ${branch}, working tree clean` }
    return { id: this.id, label: this.label, status: "info", detail: `branch ${branch}, ${dirty} uncommitted change(s)` }
  },
}

export const storageCheck: Check = {
  id: "storage",
  label: "Storage",
  async run(ctx) {
    const entries: Array<[string, string]> = [
      ["data", ctx.paths.data],
      ["cache", ctx.paths.cache],
      ["config", ctx.paths.config],
      ["state", ctx.paths.state],
    ]
    const problems: string[] = []
    let failed = false
    for (const [name, dir] of entries) {
      if (!(await ctx.exists(dir))) {
        problems.push(`${name} directory is missing (${dir})`)
        continue
      }
      if (!(await ctx.accessWritable(dir))) {
        problems.push(`${name} directory is not writable (${dir})`)
        failed = true
      }
    }
    if (problems.length === 0)
      return { id: this.id, label: this.label, status: "pass", detail: `${entries.length} directories writable` }
    return {
      id: this.id,
      label: this.label,
      status: failed ? "fail" : "warn",
      detail: problems.join("; "),
      hint: failed ? "restore write permissions so coderrupee can persist state" : "recreate the missing directory or reinstall",
    }
  },
}

// Heuristic floors: below 1 GiB updates and caches get tight, below 256 MiB writes start failing.
const DISK_WARN_BYTES = 1024 * 1024 * 1024
const DISK_FAIL_BYTES = 256 * 1024 * 1024

export const diskCheck: Check = {
  id: "disk",
  label: "Disk",
  async run(ctx) {
    const stats = await ctx.statfs(ctx.paths.data)
    if (!stats)
      return { id: this.id, label: this.label, status: "info", detail: `could not determine free space for ${ctx.paths.data}` }
    const free = stats.bsize * stats.bavail
    if (free < DISK_FAIL_BYTES)
      return {
        id: this.id,
        label: this.label,
        status: "fail",
        detail: `${formatBytes(free)} free on the volume containing ${ctx.paths.data}`,
        hint: "free up space so coderrupee can write sessions and logs",
      }
    if (free < DISK_WARN_BYTES)
      return {
        id: this.id,
        label: this.label,
        status: "warn",
        detail: `${formatBytes(free)} free on the volume containing ${ctx.paths.data}`,
        hint: "consider freeing up space on this volume",
      }
    return { id: this.id, label: this.label, status: "pass", detail: `${formatBytes(free)} free on the volume containing ${ctx.paths.data}` }
  },
}

export const checks: Check[] = [
  installationCheck,
  runtimeCheck,
  authCheck,
  configCheck,
  projectCheck,
  storageCheck,
  diskCheck,
]

export interface DoctorReport {
  readonly checks: CheckResult[]
  readonly ok: boolean
  readonly counts: Record<Status, number>
}

export async function runChecks(input: { context: DoctorContext }): Promise<DoctorReport> {
  const results: CheckResult[] = []
  for (const check of checks) {
    results.push(await runCheck(check, input.context))
  }
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, info: 0 }
  for (const result of results) counts[result.status]++
  return { checks: results, ok: counts.warn === 0 && counts.fail === 0, counts }
}

async function runCheck(check: Check, ctx: DoctorContext): Promise<CheckResult> {
  try {
    return await check.run(ctx)
  } catch (err) {
    return { id: check.id, label: check.label, status: "fail", detail: errorMessage(err) }
  }
}

function parseAuthEntries(text: string): Array<[string, unknown]> | undefined {
  try {
    const data = JSON.parse(text)
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined
    return Object.entries(data)
  } catch {
    return undefined
  }
}

async function summarizeAuth(
  entries: Array<[string, unknown]>,
  location: string,
  id: string,
  label: string,
): Promise<CheckResult> {
  if (entries.length === 0) return { id, label, status: "info", detail: `no credentials stored in ${location}` }
  const { Auth } = await import("@/auth")
  const invalid = entries
    .filter(([, value]) => !decodes(Auth.Info, value))
    .map(([key]) => key)
  const validCount = entries.length - invalid.length
  if (invalid.length === 0) return { id, label, status: "pass", detail: `${validCount} provider(s) in ${location}` }
  return {
    id,
    label,
    status: "warn",
    detail: `${validCount} valid provider(s) in ${location}; unreadable entries: ${invalid.join(", ")}`,
    hint: "re-authenticate the listed providers to repair their stored credentials",
  }
}

function decodes<S extends Schema.Decoder<unknown, never>>(schema: S, value: unknown): boolean {
  return Exit.isSuccess(Schema.decodeUnknownExit(schema)(value, { errors: "first" }))
}

// ConfigParse.jsonc is the canonical strict parser, but it embeds the whole file
// in its error; doctor reports one-line details instead.
function parseJsoncCompact(text: string): { data: unknown; errors: string[] } {
  const issues: ParseError[] = []
  const data = parse(text, issues, { allowTrailingComma: true })
  const errors = issues.map((issue) => {
    const line = text.substring(0, issue.offset).split("\n").length
    return `${printParseErrorCode(issue.error)} at line ${line}`
  })
  return { data, errors }
}

async function schemaIssues(value: unknown): Promise<string[]> {
  const { ConfigV1 } = await import("@coderrupee/core/v1/config/config")
  const decoded = Schema.decodeUnknownExit(ConfigV1.Info)(value, {
    errors: "all",
    onExcessProperty: "ignore",
    propertyOrder: "original",
  })
  if (Exit.isSuccess(decoded)) return []
  const error = Cause.squash(decoded.cause)
  if (!Schema.isSchemaError(error)) return [String(error)]
  return SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => {
    const path = issue.path?.map(String).join(".")
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? ""
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}
