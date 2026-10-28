export * as UpdateHistory from "./update-history"

import fs from "fs"
import path from "path"
import { Global } from "@coderrupee/core/global"
import { ConfigParse } from "@/config/parse"

// Records the previous version after every successful upgrade so `coderrupee upgrade --rollback` and the
// /update dialog can offer it again. The file is tiny and machine-local, so concurrent writes are
// last-one-wins.
export const MAX_ENTRIES = 5

export type Entry = {
  fromVersion: string
  toVersion: string
  channel: string
  date: string
}

export function file(dataDir = Global.Path.data) {
  return path.join(dataDir, "update-history.json")
}

export function read(dataDir = Global.Path.data): Entry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file(dataDir), "utf8"))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Entry).fromVersion === "string" &&
        typeof (entry as Entry).toVersion === "string" &&
        typeof (entry as Entry).channel === "string" &&
        typeof (entry as Entry).date === "string",
    )
  } catch {
    return []
  }
}

export function record(input: { fromVersion: string; toVersion: string; channel: string }, dataDir = Global.Path.data) {
  const entry: Entry = {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    channel: input.channel,
    date: new Date().toISOString(),
  }
  const entries = [...read(dataDir), entry].slice(-MAX_ENTRIES)
  fs.writeFileSync(file(dataDir), JSON.stringify(entries, null, 2) + "\n")
  return entries
}

export function last(entries: Entry[]) {
  return entries[entries.length - 1]
}

// Best-effort channel from the global config file. Mirrors the global config candidate order; an
// unreadable or invalid file falls back to the default channel.
export function currentChannel(configDir = Global.Path.config): "stable" | "beta" {
  for (const name of ["coderrupee.jsonc", "coderrupee.json", "config.json"]) {
    try {
      const parsed = ConfigParse.jsonc(fs.readFileSync(path.join(configDir, name), "utf8"), name)
      if (!parsed || typeof parsed !== "object") continue
      const channel = (parsed as { channel?: unknown }).channel
      if (channel === "stable" || channel === "beta") return channel
    } catch {
      // Missing or unparsable candidates fall through to the next one.
    }
  }
  return "stable"
}
