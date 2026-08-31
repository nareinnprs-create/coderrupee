import { app, dialog, shell } from "electron"
import pkg from "electron-updater"
import { UNSIGNED_BUILD, UPDATER_ENABLED } from "./constants"
import { createUpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"

const { autoUpdater } = pkg
const key = "ready"

const RELEASE_API = "https://api.github.com/repos/nareinnprs-create/coderrupee/releases/latest"
const RELEASES_PAGE = "https://github.com/nareinnprs-create/coderrupee/releases/latest"

async function fetchLatestVersion(logger: ReturnType<typeof getLogger>) {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub releases responded ${response.status}`)
  const body = (await response.json()) as { tag_name?: string }
  const version = body.tag_name?.replace(/^v/, "")
  if (!version) throw new Error("GitHub releases missing tag_name")
  logger.log("manual update check", { version })
  return version
}

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()

  if (UNSIGNED_BUILD) {
    return createUpdaterController({
      enabled: UPDATER_ENABLED,
      currentVersion: app.getVersion(),
      backend: {
        checkForUpdates: async () => {
          const version = await fetchLatestVersion(logger)
          return {
            isUpdateAvailable: version !== app.getVersion(),
            updateInfo: { version },
          }
        },
        downloadUpdate: async () => {
          // No-op for unsigned builds: background checks must not auto-open the
          // browser. The explicit menu action shows the dialog which opens the
          // release page on user request.
        },
        quitAndInstall: () => {
          setAppQuitting()
          app.quit()
        },
      },
      persistence: { get: () => undefined, set: () => {}, clear: () => {} },
      stop,
      log: (message, data) => logger.log(message, data),
    })
  }

  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  const store = getStore("coderrupee.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => {
        // quitAndInstall closes all windows before emitting before-quit, so
        // flag the quit first to keep window ids persisted for restore.
        setAppQuitting()
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running; clear the flag so
          // deliberate window closes prune ids again.
          setAppQuitting(false)
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  if (UNSIGNED_BUILD) return showManualUpdaterDialog(alertOnFail)

  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}

async function showManualUpdaterDialog(alertOnFail: boolean) {
  const logger = getLogger()
  try {
    const version = await fetchLatestVersion(logger)
    if (version === app.getVersion()) {
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "info",
        message: nativeT("desktop.updater.dialog.upToDate.message"),
        title: nativeT("desktop.updater.dialog.upToDate.title"),
      })
      return
    }
    const response = await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.manual.message", { version }),
      title: nativeT("desktop.updater.dialog.manual.title"),
      buttons: [nativeT("desktop.updater.dialog.manual.download"), nativeT("desktop.updater.dialog.later")],
      defaultId: 0,
      cancelId: 1,
    })
    if (response.response === 0) {
      await shell.openExternal(RELEASES_PAGE)
    }
  } catch (error) {
    if (!alertOnFail) return
    logger.log("manual update check failed", { message: error instanceof Error ? error.message : String(error) })
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
  }
}
