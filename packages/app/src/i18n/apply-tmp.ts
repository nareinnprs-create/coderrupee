import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = import.meta.dir
const translations: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(join(dir, "translations-tmp.json"), "utf8"),
)
const order = [
  "desktop.updater.notification.available.title",
  "desktop.updater.notification.available.message",
  "desktop.updater.notification.downloading.title",
  "desktop.updater.notification.downloading.message",
  "desktop.upder.NEVER",
  "desktop.updater.notification.ready.title",
  "desktop.updater.notification.ready.message",
  "desktop.updater.notification.installing.title",
  "desktop.updater.notification.installing.message",
  "desktop.updater.notification.manualMac.title",
  "desktop.updater.notification.manualMac.message",
  "desktop.updater.notification.manualLinux.title",
  "desktop.updater.notification.manualLinux.message",
  "desktop.updater.notification.failed.title",
  "desktop.updater.notification.failed.message",
].filter((key) => key !== "desktop.upder.NEVER")

const expected = order.slice()
for (const [locale, dict] of Object.entries(translations)) {
  const keys = Object.keys(dict)
  if (keys.length !== expected.length || expected.some((key) => !(key in dict))) {
    throw new Error(`${locale}: payload keys mismatch (${keys.length})`)
  }
  for (const key of order) {
    const placeholders = [...dict[key].matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]).sort().join()
    const wanted = ["available", "downloading", "ready", "installing", "manualLinux"].some((n) =>
      key.endsWith(`${n}.message`),
    )
      ? "version"
      : ""
    if (placeholders !== wanted) throw new Error(`${locale}:${key}: placeholder mismatch (${placeholders})`)
  }
}

const updated: string[] = []
for (const [locale, dict] of Object.entries(translations)) {
  const path = join(dir, `${locale}.ts`)
  let text = readFileSync(path, "utf8")
  if (text.includes("desktop.updater.notification.")) throw new Error(`${locale}: keys already present`)
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const anchors = ['"desktop.updater.dialog.later"', '"toast.update.action.notYet"']
  const lines = text.split(eol)
  let anchorIndex = -1
  for (const anchor of anchors) {
    anchorIndex = lines.findIndex((line) => line.includes(anchor))
    if (anchorIndex !== -1) break
  }
  if (anchorIndex === -1) throw new Error(`${locale}: no anchor found`)
  const anchorLine = lines[anchorIndex]
  if (anchorIndex !== lines.findIndex((line) => line.includes(anchorLine)) || lines.filter((l) => l === anchorLine).length !== 1) {
    throw new Error(`${locale}: anchor line not unique`)
  }
  const hasComma = anchorLine.trimEnd().endsWith(",")
  const newLines = order.map((key, index) => {
    const comma = index === order.length - 1 && !hasComma ? "" : ","
    return `  ${JSON.stringify(key)}: ${JSON.stringify(dict[key])}${comma}`
  })
  lines.splice(anchorIndex + 1, 0, ...newLines)
  if (!hasComma) lines[anchorIndex] = anchorLine + ","
  writeFileSync(path, lines.join(eol))
  updated.push(locale)
}
console.log(`updated ${updated.length} locales: ${updated.join(" ")}`)
