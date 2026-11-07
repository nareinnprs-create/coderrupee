import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { UPDATER_ENABLED } from "./constants"
import { createCloseToTraySetting } from "./close-to-tray"
import { write as writeLog } from "./logging"
import { nativeT } from "./native-translations"
import { getStore } from "./store"
import { buildTrayMenu, type TrayMenuItem } from "./tray-menu"
import { getLastFocusedWindow, restoreMainWindows } from "./windows"

const root = dirname(fileURLToPath(import.meta.url))

export type TrayActions = {
  newSession: () => void
  checkForUpdates: () => void
  quit: () => void
}

const closeToTray = createCloseToTraySetting({
  get: (key) => getStore().get(key),
  set: (key, value) => getStore().set(key, value),
})

let tray: Tray | null = null
let actions: TrayActions | null = null
let notifiedCloseToTray = false

export const getCloseToTrayEnabled = closeToTray.get

export function setCloseToTrayEnabled(enabled: boolean) {
  const previous = closeToTray.get()
  closeToTray.set(enabled)
  if (enabled && !previous) notifyCloseToTrayOnce()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("close-to-tray-enabled-changed", enabled)
  }
}

export function createTray(next: TrayActions) {
  actions = next
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip(app.getName())
  tray.on("click", () => showFromTray())
  tray.on("double-click", () => showFromTray())
  rebuildTrayMenu()
  return tray
}

export function rebuildTrayMenu() {
  if (!tray || !actions) return
  const items = buildTrayMenu(
    { windowVisible: isWindowVisible(), updaterEnabled: UPDATER_ENABLED },
    {
      show: nativeT("desktop.tray.show"),
      hide: nativeT("desktop.tray.hide"),
      newSession: nativeT("desktop.menu.newSession"),
      checkForUpdates: nativeT("desktop.menu.checkForUpdates"),
      quit: nativeT("desktop.recovery.action.quit"),
    },
    {
      showWindow: showFromTray,
      hideWindow: () => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.hide()
        }
      },
      newSession: actions.newSession,
      checkForUpdates: actions.checkForUpdates,
      quit: actions.quit,
    },
  )
  tray.setContextMenu(Menu.buildFromTemplate(items.map(nativeItem)))
}

export function destroyTray() {
  tray?.destroy()
  tray = null
  actions = null
}

function nativeItem(item: TrayMenuItem): MenuItemConstructorOptions {
  if ("type" in item) return { type: "separator" }
  return { label: item.label, enabled: item.enabled, click: () => item.onPick() }
}

function isWindowVisible() {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible())
}

function showFromTray() {
  const win = getLastFocusedWindow()
  if (!win) {
    restoreMainWindows()
    return
  }
  win.show()
  win.focus()
}

// One-time toast after the setting turns on so the first close-to-tray does
// not look like the app vanished. Uses the main-process notification path and
// degrades to a log entry where native notifications are unsupported.
function notifyCloseToTrayOnce() {
  if (notifiedCloseToTray) return
  notifiedCloseToTray = true
  if (!Notification.isSupported()) {
    writeLog("tray", "close to tray enabled; native notifications unsupported", undefined, "warn")
    return
  }
  const notification = new Notification({
    title: nativeT("desktop.menu.app"),
    body: nativeT("desktop.tray.notification.message"),
  })
  notification.on("click", () => showFromTray())
  notification.show()
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function trayIcon() {
  const file = process.platform === "win32" ? join(iconsDir(), "icon.ico") : join(iconsDir(), "icon.png")
  const image = nativeImage.createFromPath(file)
  // macOS tray icons should render as monochrome template images so they
  // adapt to menu bar appearance.
  if (process.platform === "darwin" && !image.isEmpty()) image.setTemplateImage(true)
  return image
}
