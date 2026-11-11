import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"
import { pipeline } from "node:stream/promises"
import { app, dialog, Notification, shell } from "electron"
import pkg from "electron-updater"
import { UNSIGNED_BUILD, UPDATER_ENABLED } from "./constants"
import {
  createUpdaterController,
  type UpdaterBackend,
  type UpdaterController,
  type UpdaterReadyRecord,
} from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"

const { autoUpdater } = pkg
const key = "ready"
const notifiedKey = "lastNotifiedVersion"

const RELEASE_API = "https://api.github.com/repos/nareinnprs-create/coderrupee/releases/latest"
const RELEASES_PAGE = "https://github.com/nareinnprs-create/coderrupee/releases/latest"

type LatestRelease = { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string }> }

async function fetchLatestRelease(logger: ReturnType<typeof getLogger>) {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub releases responded ${response.status}`)
  return (await response.json()) as LatestRelease
}

async function fetchLatestVersion(logger: ReturnType<typeof getLogger>) {
  const release = await fetchLatestRelease(logger)
  const version = release.tag_name?.replace(/^v/, "")
  if (!version) throw new Error("GitHub releases missing tag_name")
  logger.log("manual update check", { version })
  return version
}

function showUpdateNotification(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  if (onClick) {
    notification.on("click", () => {
      notification.close()
      onClick()
    })
  }
  notification.show()
}

async function downloadReleaseAsset(logger: ReturnType<typeof getLogger>, assetName: string) {
  const release = await fetchLatestRelease(logger)
  const asset = release.assets?.find((candidate) => candidate.name === assetName)
  if (!asset?.browser_download_url) throw new Error(`GitHub release missing asset ${assetName}`)
  const target = join(app.getPath("downloads"), assetName)
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`Asset download responded ${response.status}`)
  await pipeline(Readable.fromWeb(response.body as unknown as ReadableStream), createWriteStream(target))
  return target
}

// Unsigned release artifacts carry no code signature, so electron-updater
// cannot stage them: download the release asset and hand it to the OS instead.
async function installUnsignedUpdate(logger: ReturnType<typeof getLogger>) {
  const platform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"
  const assetName = `coderrupee-desktop-${platform}-${process.arch}.${platform === "win" ? "exe" : platform === "mac" ? "dmg" : "AppImage"}`
  const target = await downloadReleaseAsset(logger, assetName)

  if (process.platform === "win32") {
    showUpdateNotification(
      nativeT("desktop.updater.notification.installing.title"),
      nativeT("desktop.updater.notification.installing.message"),
    )
    // Detached silent NSIS: the installer survives the app quitting.
    const child = spawn(target, ["/S"], { detached: true, stdio: "ignore" })
    child.unref()
    setAppQuitting()
    app.quit()
    return
  }

  if (process.platform === "darwin") {
    await shell.openPath(target)
    showUpdateNotification(
      nativeT("desktop.updater.notification.manualMac.title"),
      nativeT("desktop.updater.notification.manualMac.message"),
    )
    return
  }

  await chmod(target, 0o755)
  shell.openPath(app.getPath("downloads"))
  showUpdateNotification(
    nativeT("desktop.updater.notification.manualLinux.title"),
    nativeT("desktop.updater.notification.manualLinux.message"),
  )
}

function attachUpdateNotifications(
  controller: UpdaterController,
  runInstall: (version: string) => Promise<void>,
  logger: ReturnType<typeof getLogger>,
) {
  const store = getStore("coderrupee.updater")
  const currentVersion = app.getVersion()
  const downloadingShown = new Set<string>()
  let flow: Promise<unknown> | undefined

  const lastNotifiedVersion = () => {
    const value = store.get(notifiedKey)
    return typeof value === "string" ? value : undefined
  }

  // One install flow at a time; a failed run clears the guard so the click can retry.
  const startInstall = (version: string) => {
    if (flow) return
    flow = runInstall(version)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.log("update install flow failed", { message })
        showUpdateNotification(
          nativeT("desktop.updater.notification.failed.title"),
          nativeT("desktop.updater.notification.failed.message"),
        )
      })
      .finally(() => {
        flow = undefined
      })
  }

  controller.subscribe((state) => {
    if (state.status === "downloading") {
      if (
        UNSIGNED_BUILD ||
        state.version === currentVersion ||
        state.version === lastNotifiedVersion() ||
        downloadingShown.has(state.version)
      ) {
        return
      }
      downloadingShown.add(state.version)
      showUpdateNotification(
        nativeT("desktop.updater.notification.downloading.title"),
        nativeT("desktop.updater.notification.downloading.message", { version: state.version }),
      )
      return
    }
    if (state.status !== "ready") return
    if (state.version === currentVersion || state.version === lastNotifiedVersion()) return
    store.set(notifiedKey, state.version)
    showUpdateNotification(
      nativeT("desktop.updater.notification.available.title"),
      nativeT("desktop.updater.notification.available.message", { version: state.version }),
      () => startInstall(state.version),
    )
  })
}

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()

  if (UNSIGNED_BUILD) {
    const controller = createUpdaterController({
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
          // No-op for unsigned builds: background checks must not auto-install.
          // The update notification click flow runs the real installer instead.
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
    attachUpdateNotifications(controller, () => installUnsignedUpdate(logger), logger)
    return controller
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
  const backend: UpdaterBackend = {
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
  }
  const controller = createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend,
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
  attachUpdateNotifications(
    controller,
    async (version) => {
      // The controller already downloaded during its check; this call resolves
      // from the electron-updater cache and surfaces the staged update.
      await backend.downloadUpdate()
      showUpdateNotification(
        nativeT("desktop.updater.notification.ready.title"),
        nativeT("desktop.updater.notification.ready.message", { version }),
        () => {
          controller.install().catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            logger.log("update install failed", { message })
          })
        },
      )
    },
    logger,
  )
  return controller
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
