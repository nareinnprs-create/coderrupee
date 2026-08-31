declare global {
  const CODERRUPEE_VERSION: string
  const CODERRUPEE_CHANNEL: string
}

export const InstallationVersion = typeof CODERRUPEE_VERSION === "string" ? CODERRUPEE_VERSION : "local"
export const InstallationChannel = typeof CODERRUPEE_CHANNEL === "string" ? CODERRUPEE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
