import { $ } from "bun"
import * as path from "path"
import * as fs from "fs"

const EXCLUDE_DIRS = [".git", "node_modules", "dist", "build", ".next", ".opencode", ".vscode", "artifacts", "packages/desktop/out"]
const EXCLUDE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz", ".lock"]

const REPLACEMENTS = [
  { from: /@opencode-ai\//g, to: "@coderrupee/" },
  { from: /anomalyco\/opencode/g, to: "coderrupee/coderrupee" },
  { from: /OpenCode AI/g, to: "CoderRupee" },
  { from: /OpenCode/g, to: "CoderRupee" },
  { from: /opencode/g, to: "coderrupee" },
  { from: /OPENCODE_/g, to: "CODERRUPEE_" }
]

// Exclude this script itself and things that shouldn't be touched (like THIRDPARTY_LICENSES)
const EXCLUDE_FILES = ["THIRDPARTY_LICENSES.txt", "rebrand.ts", "bun.lock"]

async function processDirectory(dir: string) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue
      await processDirectory(fullPath)
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.includes(entry.name)) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (EXCLUDE_EXTS.includes(ext)) continue

      try {
        let content = await fs.promises.readFile(fullPath, "utf-8")
        let changed = false

        for (const replacement of REPLACEMENTS) {
          if (replacement.from.test(content)) {
            content = content.replace(replacement.from, replacement.to)
            changed = true
          }
        }

        if (changed) {
          await fs.promises.writeFile(fullPath, content, "utf-8")
          console.log(`Updated: ${fullPath}`)
        }
      } catch (err) {
        // Might be a binary file read as utf-8, ignore
        console.error(`Skipping ${fullPath} due to error:`, err.message)
      }
    }
  }
}

async function run() {
  console.log("Starting rebranding process...")
  const rootDir = path.resolve(__dirname, "..")
  await processDirectory(rootDir)
  console.log("Rebranding text replacements complete.")
}

run()
