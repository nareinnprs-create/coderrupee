import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@coderrupee/core/flag/flag"
import { errorMessage } from "@/util/error"
import { Installation } from "@/installation"
import { InstallationVersion } from "@coderrupee/core/installation/version"
import { UpdateHistory } from "@/installation/update-history"

// Checking never installs anything. Updates only happen when the user runs `/update` or `coderrupee upgrade`.
export function shouldNotify(input: {
  autoupdate: boolean | "notify" | undefined
  disabled: boolean
  always: boolean
  current: string
  latest: string
}) {
  if (input.autoupdate === false || input.disabled) return false
  if (input.always) return true
  return Installation.isUpdate(input.current, input.latest)
}

// Returns undefined when checks are disabled or fail.
export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.CODERRUPEE_DISABLE_AUTOUPDATE) return
  const latest = await Installation.latest(await Installation.method(), config.channel).catch(() => {})
  if (!latest) return
  if (
    shouldNotify({
      autoupdate: config.autoupdate,
      disabled: Flag.CODERRUPEE_DISABLE_AUTOUPDATE,
      always: Flag.CODERRUPEE_ALWAYS_NOTIFY_UPDATE,
      current: InstallationVersion,
      latest,
    })
  )
    return { type: "available" as const, version: latest }
}

// Only package-manager installs carry coderrupee-ai versions, so only they can reinstall a previous
// release. brew, curl, choco, and scoop builds have no honest way to fetch an arbitrary old version.
export function rollbackSupported(method: Installation.Method) {
  return method === "npm" || method === "yarn" || method === "pnpm" || method === "bun"
}

// A rollback reinstalls the version that was installed before the most recent history entry. Because
// every successful rollback appends its own entry, rolling back again points back the other way.
export function rollbackTarget(history: UpdateHistory.Entry[]) {
  return UpdateHistory.last(history)?.fromVersion
}

export type RollbackResult =
  | { type: "empty" }
  | { type: "unsupported"; method: Installation.Method }
  | { type: "current"; version: string }
  | { type: "failed"; message: string }
  | { type: "done"; version: string }

export async function rollback(): Promise<RollbackResult> {
  const entry = UpdateHistory.last(UpdateHistory.read())
  if (!entry) return { type: "empty" }
  const method = await Installation.method()
  if (!rollbackSupported(method)) return { type: "unsupported", method }
  if (entry.fromVersion === InstallationVersion) return { type: "current", version: entry.fromVersion }
  const error = await Installation.upgrade(method, entry.fromVersion).catch((err: unknown) => err)
  if (error) return { type: "failed", message: errorMessage(error) }
  UpdateHistory.record({
    fromVersion: InstallationVersion,
    toVersion: entry.fromVersion,
    channel: UpdateHistory.currentChannel(),
  })
  return { type: "done", version: entry.fromVersion }
}
