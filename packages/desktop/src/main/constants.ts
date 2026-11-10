import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.CODERRUPEE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
// Defined at build time by electron.vite.config.ts; runtime env vars do not
// survive into the packaged app.
export const UNSIGNED_BUILD = import.meta.env.CODERRUPEE_UNSIGNED === "1"
