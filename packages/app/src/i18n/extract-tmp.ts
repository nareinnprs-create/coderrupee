import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir)
const files = readdirSync(dir).filter((f) => /^[a-z]{2,3}\.ts$/.test(f) && f !== "en.ts")
const pattern =
  /"((?:desktop\.updater\.dialog|toast\.update(?:\.action)?|settings\.updates\.action)\.[A-Za-z.]+)":\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
const out: Record<string, Record<string, string>> = {}
for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8")
  const dict: Record<string, string> = {}
  for (const match of text.matchAll(pattern)) {
    dict[match[1]] = match[2] ?? match[3] ?? ""
  }
  out[file.replace(".ts", "")] = dict
}
writeFileSync(join(dir, "terminology-tmp.json"), JSON.stringify(out, null, 2))
console.log("locales:", Object.keys(out).length)
