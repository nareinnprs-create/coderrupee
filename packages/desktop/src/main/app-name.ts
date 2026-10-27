// Renderer-supplied app names reach path lookups (macOS .app probing, the
// Windows `where` search). Keep the validation pure and Electron-free so it
// can be unit-tested, including traversal attempts.
const appNamePattern = /^[A-Za-z0-9 ._\-]+$/
const maxAppNameLength = 128

export class InvalidAppNameError extends Error {
  constructor(reason: string) {
    super(`Invalid app name: ${reason}`)
    this.name = "InvalidAppNameError"
  }
}

// Returns the name unchanged when it is a bare app name; throws otherwise.
// Absolute paths, traversal segments, and separators are rejected before any
// path resolution can use the value.
export function sanitizeAppName(value: string) {
  if (typeof value !== "string" || value.length === 0) throw new InvalidAppNameError("empty")
  if (value.length > maxAppNameLength) throw new InvalidAppNameError("too long")
  if (value === "." || value === "..") throw new InvalidAppNameError("path segment")
  if (value.includes("/") || value.includes("\\")) throw new InvalidAppNameError("path separator")
  if (value.includes(":")) throw new InvalidAppNameError("absolute path")
  if (value.trim().length === 0) throw new InvalidAppNameError("whitespace only")
  if (!appNamePattern.test(value)) throw new InvalidAppNameError("unsupported characters")
  return value
}
