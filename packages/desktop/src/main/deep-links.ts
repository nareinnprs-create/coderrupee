const deepLinkPrefix = "coderrupee://"

// Pure so cold-start argv parsing can be unit-tested without Electron.
export function parseDeepLinksFromArgv(argv: string[]) {
  return argv.filter((arg) => arg.startsWith(deepLinkPrefix))
}
