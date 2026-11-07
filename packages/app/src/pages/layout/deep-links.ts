export const deepLinkEvent = "coderrupee:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("coderrupee://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

// Click-through target for native notifications; the desktop main process
// builds these via buildSessionDeepLink and routes them here on click.
export const parseSessionDeepLink = (input: string): { directory: string; sessionID?: string } | undefined => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return { directory, sessionID: url.searchParams.get("id") || undefined }
}

export const collectSessionDeepLinks = (urls: string[]) =>
  urls.map(parseSessionDeepLink).filter((link): link is { directory: string; sessionID?: string } => !!link)

type CoderRupeeWindow = Window & {
  __CODERRUPEE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: CoderRupeeWindow) => {
  const pending = target.__CODERRUPEE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__CODERRUPEE__) target.__CODERRUPEE__.deepLinks = []
  return pending
}
