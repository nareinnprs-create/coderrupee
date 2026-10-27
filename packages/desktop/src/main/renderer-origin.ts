// Definition of the app's own renderer origin, shared by window loading,
// permission checks, and IPC sender validation. Kept free of Electron
// imports so the trust decision can be unit-tested.
export const rendererProtocol = "oc"
export const rendererHost = "renderer"

export type TrustedSenderEvent = { senderFrame?: { url?: string } | null }

export function isRendererOriginUrl(value: string | undefined | null, options?: { html?: boolean; devUrl?: string }) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (options?.html && !url.pathname.endsWith(".html")) return false
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = options?.devUrl
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}

// Packaged windows load oc://renderer/index.html; dev windows load the
// electron-vite server URL. Anything else must not drive state-changing IPC.
export function isTrustedSender(event: TrustedSenderEvent, options?: { devUrl?: string }) {
  return isRendererOriginUrl(event.senderFrame?.url, options)
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`Untrusted IPC sender for "${channel}"`)
    this.name = "UntrustedSenderError"
  }
}
