export * as ConfigMarkdown from "./markdown"

import matter from "gray-matter"
export function parse(content: string) {
  try {
    const direct = matter(content)
    // Some YAML engines silently swallow unquoted `key: value: more` lines into
    // incomplete mappings instead of throwing; when parsed data misses any raw
    // top-level frontmatter key, prefer the permissive sanitized re-parse.
    if (coversFrontmatterKeys(direct.data, content)) return direct
  } catch {
    /* fall through to the permissive parse */
  }
  return matter(sanitize(content))
}

function coversFrontmatterKeys(data: Record<string, unknown>, content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return true
  const keys = match[1]
    .split(/\r?\n/)
    .filter((line) => /^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(line))
    .map((line) => line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)![1])
  return keys.every((key) => data[key] !== undefined)
}

export function parseOption(content: string) {
  try {
    return parse(content)
  } catch {
    return undefined
  }
}

// Other coding agents accept unquoted colons in frontmatter values. Retry
// those values as YAML block scalars so existing config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  const result = frontmatter.split(/\r?\n/).flatMap((line) => {
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const value = entry[2].trim()
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]
    if (!value.includes(":")) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}
