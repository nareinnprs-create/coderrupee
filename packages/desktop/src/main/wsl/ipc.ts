import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { WslServersController } from "./servers"
import { requireWslIpcString, requireWslIpcStrings } from "./policy"
import type { WslServersState } from "../../preload/types"
import { nativeT } from "../native-translations"
import { isTrustedSender, UntrustedSenderError } from "../renderer-origin"
import { write as writeLog } from "../logging"

// WSL handlers drive OS-level actions (wsl.exe installs, terminals, server
// lifecycle), so they are locked to the app's own renderer origin like the
// state-changing handlers in main/ipc.ts. get-state and unsubscribe stay open.
function requireTrustedSender(channel: string, event: IpcMainInvokeEvent) {
  if (isTrustedSender(event, { devUrl: process.env.ELECTRON_RENDERER_URL })) return
  writeLog("ipc", "blocked untrusted sender", { channel, url: event.senderFrame?.url }, "warn")
  throw new UntrustedSenderError(channel)
}

export function registerWslIpcHandlers(controller: WslServersController) {
  if (process.platform !== "win32") {
    registerUnavailableWslIpcHandlers()
    return
  }

  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  ipcMain.handle("wsl-servers-subscribe", (event) => {
    requireTrustedSender("wsl-servers-subscribe", event)
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("wsl-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("wsl-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("wsl-servers-get-state", () => controller.getState())
  ipcMain.handle("wsl-servers-probe-runtime", (event) => {
    requireTrustedSender("wsl-servers-probe-runtime", event)
    return controller.probeRuntime()
  })
  ipcMain.handle("wsl-servers-refresh-distros", (event) => {
    requireTrustedSender("wsl-servers-refresh-distros", event)
    return controller.refreshDistros()
  })
  ipcMain.handle("wsl-servers-install-wsl", (event) => {
    requireTrustedSender("wsl-servers-install-wsl", event)
    return controller.installWsl()
  })
  ipcMain.handle("wsl-servers-install-distro", (event: IpcMainInvokeEvent, name: string) => {
    requireTrustedSender("wsl-servers-install-distro", event)
    return controller.installDistro(requireWslIpcString("distro", name))
  })
  ipcMain.handle("wsl-servers-probe-addable", (event: IpcMainInvokeEvent, distros: string[]) => {
    requireTrustedSender("wsl-servers-probe-addable", event)
    return controller.probeAddable(requireWslIpcStrings("distro", distros))
  })
  ipcMain.handle("wsl-servers-install-coderrupee", (event: IpcMainInvokeEvent, name: string) => {
    requireTrustedSender("wsl-servers-install-coderrupee", event)
    return controller.installCoderrupee(requireWslIpcString("distro", name))
  })
  ipcMain.handle("wsl-servers-open-terminal", (event: IpcMainInvokeEvent, name: string) => {
    requireTrustedSender("wsl-servers-open-terminal", event)
    return controller.openTerminal(requireWslIpcString("distro", name))
  })
  ipcMain.handle("wsl-servers-add", (event: IpcMainInvokeEvent, distro: string) => {
    requireTrustedSender("wsl-servers-add", event)
    return controller.addServer(requireWslIpcString("distro", distro))
  })
  ipcMain.handle("wsl-servers-remove", (event: IpcMainInvokeEvent, id: string) => {
    requireTrustedSender("wsl-servers-remove", event)
    return controller.removeServer(requireWslIpcString("server id", id))
  })
  ipcMain.handle("wsl-servers-start", (event: IpcMainInvokeEvent, id: string) => {
    requireTrustedSender("wsl-servers-start", event)
    return controller.startServer(requireWslIpcString("server id", id))
  })
}

function registerUnavailableWslIpcHandlers() {
  const unavailable = () => {
    throw new Error(nativeT("desktop.wsl.error.windowsOnly"))
  }
  const state = (): WslServersState => ({
    runtime: {
      available: false,
      version: null,
      error: nativeT("desktop.wsl.error.windowsOnly"),
    },
    installed: [],
    online: [],
    distroProbes: {},
    coderrupeeChecks: {},
    pendingRestart: false,
    servers: [],
    job: null,
  })

  ipcMain.handle("wsl-servers-subscribe", (event) => {
    event.sender.send("wsl-servers-event", { type: "state", state: state() })
  })
  ipcMain.handle("wsl-servers-unsubscribe", () => undefined)
  ipcMain.handle("wsl-servers-get-state", () => state())
  ipcMain.handle("wsl-servers-probe-runtime", unavailable)
  ipcMain.handle("wsl-servers-refresh-distros", unavailable)
  ipcMain.handle("wsl-servers-install-wsl", unavailable)
  ipcMain.handle("wsl-servers-install-distro", unavailable)
  ipcMain.handle("wsl-servers-probe-addable", unavailable)
  ipcMain.handle("wsl-servers-install-coderrupee", unavailable)
  ipcMain.handle("wsl-servers-open-terminal", unavailable)
  ipcMain.handle("wsl-servers-add", unavailable)
  ipcMain.handle("wsl-servers-remove", unavailable)
  ipcMain.handle("wsl-servers-start", unavailable)
}
