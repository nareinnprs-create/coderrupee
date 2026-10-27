// D10: CSP ships report-only first; enforcement is opt-in through
// CODERRUPEE_CSP=enforce until report telemetry is reviewed, and the default
// flips to enforce in a later milestone.
export type CspMode = "report-only" | "enforce"

// The renderer fetches the local sidecar (http://127.0.0.1:<random port>,
// ws for streams) from the oc://renderer origin, so localhost http/ws are
// part of the app's real connect needs; https:/wss: covers user-configured
// remote default servers. style-src keeps 'unsafe-inline' for theme/style
// tags the app injects at runtime.
export function cspPolicy(dev: boolean) {
  const scriptSrc = dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'"
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws://127.0.0.1:* ws://localhost:* wss:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
  ].join("; ")
}

export function resolveCspMode(envValue: string | undefined): CspMode {
  return envValue === "enforce" ? "enforce" : "report-only"
}

export function cspHeader(dev: boolean, mode: CspMode): { name: string; value: string } {
  return {
    name: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: cspPolicy(dev),
  }
}
