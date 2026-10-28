// OS credential storage for provider credentials.
//
// Backend choice (one per platform, no new native dependencies):
// - Windows: a single DPAPI-protected vault file (auth.vault) holding all
//   credentials under one CryptProtectData blob, CurrentUser scope, written
//   through one-shot powershell.exe invocations. `cmdkey` cannot read secrets
//   back, and a resident PowerShell handle would need process-lifecycle
//   management for no real gain, so the blob is cached in memory per process
//   and PowerShell is only spawned on the first read and on writes.
// - macOS: one generic password per credential via /usr/bin/security
//   (`find/add/delete-generic-password`), plus an "$index" item enumerating
//   accounts because the CLI cannot list items for a service. The secret is
//   briefly visible in the process argument list on `add`; accepted because
//   every CLI consumer of the keychain has the same exposure.
// - Linux: `secret-tool` (libsecret) items with `application coderrupee
//   account <id>` attributes and the same "$index" convention, because
//   `secret-tool search` output is unreliable to parse. Requires a running
//   secret service; absence degrades to "none".
//
// Tradeoffs of the DPAPI blob: any code running as the same OS user can
// decrypt (DPAPI has no per-app isolation without extra entropy, which would
// only be obfuscation if stored alongside), and the vault is a single file so
// one corrupt blob hides every credential - recovery keeps the corrupt file
// and Auth falls back to the plaintext copy it preserved at migration time.
// Per-credential addressing ({service: "coderrupee", account: providerID}) is
// preserved logically: the blob is a JSON map of account -> serialized value.

import { AppProcess } from "@coderrupee/core/process"
import { FSUtil } from "@coderrupee/core/fs-util"
import { Global } from "@coderrupee/core/global"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import path from "path"
import { ChildProcess } from "effect/unstable/process"
import { Context, Effect, Layer, Schema } from "effect"

export type Backend = "dpapi-vault" | "macos-security" | "linux-secret-tool" | "none"

export class KeyringError extends Schema.TaggedErrorClass<KeyringError>()("KeyringError", {
  message: Schema.String,
  backend: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly backend: () => Backend
  readonly isAvailable: () => Effect.Effect<boolean>
  /** Returns the serialized value stored for one credential, if any. */
  readonly get: (account: string) => Effect.Effect<string | undefined, KeyringError>
  /** Stores or replaces the serialized value for one credential. */
  readonly set: (account: string, value: string) => Effect.Effect<void, KeyringError>
  /** Removes one credential; removing an absent credential succeeds. */
  readonly delete: (account: string) => Effect.Effect<void, KeyringError>
  /** Returns every stored credential keyed by account. */
  readonly list: () => Effect.Effect<Record<string, string>, KeyringError>
}

export class Service extends Context.Service<Service, Interface>()("@coderrupee/Auth/Keyring") {}

/** Accounts are addressed as service "coderrupee" + account; see module header. */
export const SERVICE = "coderrupee"
const INDEX_ACCOUNT = "$index"

const detect = (): Backend => {
  if (process.platform === "win32" && Bun.which("powershell.exe")) return "dpapi-vault"
  if (process.platform === "darwin" && Bun.which("security")) return "macos-security"
  if (process.platform === "linux" && Bun.which("secret-tool")) return "linux-secret-tool"
  return "none"
}

const DPAPI_TIMEOUT = "30 seconds"

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $raw = [Console]::In.ReadToEnd().Trim()
  $plain = [Convert]::FromBase64String($raw)
  $enc = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($enc))
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}`

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $raw = [Console]::In.ReadToEnd().Trim()
  $enc = [Convert]::FromBase64String($raw)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}`

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const backend = detect()
    const appProcess = yield* AppProcess.Service
    const fsys = yield* FSUtil.Service

    const error = (op: string, cause?: unknown) =>
      new KeyringError({ message: `keyring ${op} failed`, backend, cause })

    const runWindows = Effect.fn("Keyring.dpapi")(function* (script: string, payload: string) {
      const result = yield* appProcess
        .run(ChildProcess.make("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]), {
          stdin: payload,
          timeout: DPAPI_TIMEOUT,
        })
        .pipe(Effect.mapError((cause) => error("powershell", cause)))
      if (result.exitCode !== 0) {
        return yield* error("powershell", result.stderr.toString("utf8"))
      }
      return result.stdout.toString("utf8").trim()
    })

    const runOk = Effect.fn("Keyring.runOk")(function* (
      command: string,
      args: string[],
      options?: { stdin?: string },
    ) {
      const result = yield* appProcess
        .run(ChildProcess.make(command, args), { stdin: options?.stdin, timeout: DPAPI_TIMEOUT })
        .pipe(Effect.mapError((cause) => error(command, cause)))
      return result
    })

    // --- Windows DPAPI vault -------------------------------------------------

    const vaultPath = path.join(Global.Path.data, "auth.vault")
    const vaultTemp = vaultPath + ".tmp"
    let vault: Record<string, string> | undefined

    const decodeVault = (plain: string): Record<string, string> => {
      const parsed: unknown = JSON.parse(Buffer.from(plain, "base64").toString("utf8"))
      const entries = (parsed as { entries?: unknown } | null)?.entries
      if (typeof parsed !== "object" || parsed === null || typeof entries !== "object" || entries === null) {
        throw new Error("vault envelope is not an entries object")
      }
      const result: Record<string, string> = {}
      for (const [account, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof value !== "string") throw new Error(`vault entry ${account} is not a string`)
        result[account] = value
      }
      return result
    }

    const encodeVault = (entries: Record<string, string>): string =>
      Buffer.from(JSON.stringify({ version: 1, entries }), "utf8").toString("base64")

    const readVault = Effect.fn("Keyring.readVault")(function* () {
      if (vault) return vault
      const text = yield* fsys.readFileStringSafe(vaultPath).pipe(Effect.mapError((cause) => error("vault read", cause)))
      if (text === undefined) {
        vault = {}
        return vault
      }
      const plain = yield* runWindows(UNPROTECT_SCRIPT, text.trim())
      const decoded = yield* Effect.try({
        try: () => decodeVault(plain),
        catch: (cause) => error("vault decode", cause),
      })
      vault = decoded
      return vault
    })

    const writeVault = Effect.fn("Keyring.writeVault")(function* (entries: Record<string, string>) {
      const blob = yield* runWindows(PROTECT_SCRIPT, encodeVault(entries))
      yield* fsys.writeFileString(vaultTemp, blob).pipe(Effect.mapError((cause) => error("vault write", cause)))
      yield* fsys.chmod(vaultTemp, 0o600).pipe(Effect.mapError((cause) => error("vault write", cause)))
      yield* fsys.rename(vaultTemp, vaultPath).pipe(Effect.mapError((cause) => error("vault write", cause)))
      vault = entries
    })

    // Re-read before mutations so concurrent processes merge per-account
    // instead of clobbering the whole blob with a stale snapshot.
    const mutateVault = Effect.fn("Keyring.mutateVault")(function* (mutate: (entries: Record<string, string>) => boolean) {
      vault = undefined
      const entries = yield* readVault()
      const next = { ...entries }
      if (!mutate(next)) return
      yield* writeVault(next)
    })

    // --- macOS security / Linux secret-tool ----------------------------------

    const itemNotFound = (result: { exitCode: number }) => result.exitCode === 44

    const macGet = Effect.fn("Keyring.macGet")(function* (account: string) {
      const result = yield* runOk("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"])
      if (result.exitCode !== 0) {
        if (itemNotFound(result)) return undefined
        return yield* error("security find-generic-password", result.stderr.toString("utf8"))
      }
      return result.stdout.toString("utf8").replace(/\n$/, "")
    })

    const macSet = Effect.fn("Keyring.macSet")(function* (account: string, value: string) {
      const result = yield* runOk("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value])
      if (result.exitCode !== 0) return yield* error("security add-generic-password", result.stderr.toString("utf8"))
    })

    const macDelete = Effect.fn("Keyring.macDelete")(function* (account: string) {
      const result = yield* runOk("security", ["delete-generic-password", "-s", SERVICE, "-a", account])
      if (result.exitCode !== 0 && !itemNotFound(result)) {
        return yield* error("security delete-generic-password", result.stderr.toString("utf8"))
      }
    })

    const linuxGet = Effect.fn("Keyring.linuxGet")(function* (account: string) {
      const result = yield* runOk("secret-tool", ["lookup", "application", SERVICE, "account", account])
      const value = result.stdout.toString("utf8")
      // secret-tool exits 0 both for a hit and for "no such item"; an empty
      // stdout is the only reliable "absent" signal (we never store empty).
      if (result.exitCode !== 0 || value === "") return undefined
      return value
    })

    const linuxSet = Effect.fn("Keyring.linuxSet")(function* (account: string, value: string) {
      const result = yield* runOk(
        "secret-tool",
        ["store", "--label=CoderRupee credential", "application", SERVICE, "account", account],
        { stdin: value },
      )
      if (result.exitCode !== 0) return yield* error("secret-tool store", result.stderr.toString("utf8"))
    })

    const linuxDelete = Effect.fn("Keyring.linuxDelete")(function* (account: string) {
      const result = yield* runOk("secret-tool", ["clear", "application", SERVICE, "account", account])
      if (result.exitCode !== 0) return yield* error("secret-tool clear", result.stderr.toString("utf8"))
    })

    const itemGet = backend === "macos-security" ? macGet : linuxGet
    const itemSet = backend === "macos-security" ? macSet : linuxSet
    const itemDelete = backend === "macos-security" ? macDelete : linuxDelete

    const parseIndex = (value: string | undefined): string[] => {
      if (value === undefined) return []
      try {
        const parsed: unknown = JSON.parse(value)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((account): account is string => typeof account === "string")
      } catch {
        return []
      }
    }

    // The index is bookkeeping, not a credential: a corrupt or missing index
    // reads as empty and is repaired on the next set/delete.
    const readIndex = Effect.fn("Keyring.readIndex")(function* () {
      return parseIndex(yield* itemGet(INDEX_ACCOUNT))
    })

    const writeIndex = Effect.fn("Keyring.writeIndex")(function* (accounts: string[]) {
      yield* itemSet(INDEX_ACCOUNT, JSON.stringify(accounts))
    })

    const withIndex = Effect.fn("Keyring.withIndex")(function* (account: string, remove: boolean) {
      const accounts = yield* readIndex()
      const next = remove ? accounts.filter((existing) => existing !== account) : accounts.includes(account) ? accounts : [...accounts, account]
      if (next === accounts) return
      yield* writeIndex(next)
    })

    // --- Unified interface ----------------------------------------------------

    const isAvailable = Effect.fn("Keyring.isAvailable")(function* () {
      return backend !== "none"
    })

    const get = Effect.fn("Keyring.get")(function* (account: string) {
      if (backend === "none") return yield* error("get")
      if (backend === "dpapi-vault") return (yield* readVault())[account]
      return yield* itemGet(account)
    })

    const set = Effect.fn("Keyring.set")(function* (account: string, value: string) {
      if (backend === "none") return yield* error("set")
      if (backend === "dpapi-vault") {
        yield* mutateVault((entries) => {
          entries[account] = value
          return true
        })
        return
      }
      yield* itemSet(account, value)
      yield* withIndex(account, false)
    })

    const remove = Effect.fn("Keyring.delete")(function* (account: string) {
      if (backend === "none") return yield* error("delete")
      if (backend === "dpapi-vault") {
        yield* mutateVault((entries) => {
          if (!(account in entries)) return false
          delete entries[account]
          return true
        })
        return
      }
      yield* itemDelete(account)
      yield* withIndex(account, true)
    })

    const list = Effect.fn("Keyring.list")(function* () {
      if (backend === "none") return yield* error("list")
      if (backend === "dpapi-vault") {
        const entries = yield* readVault()
        return { ...entries }
      }
      const accounts = yield* readIndex()
      const pairs = yield* Effect.forEach(
        accounts,
        (account) =>
          Effect.gen(function* () {
            const value = yield* itemGet(account).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("ignoring unreadable keyring entry", { account, cause }).pipe(Effect.as(undefined)),
              ),
            )
            return value === undefined ? undefined : ([account, value] as const)
          }),
        { concurrency: "unbounded" },
      )
      return Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair !== undefined))
    })

    return Service.of({ backend: () => backend, isAvailable, get, set, delete: remove, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node, FSUtil.node] })

export * as Keyring from "./keyring"
