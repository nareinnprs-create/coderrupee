import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"

import { Deferred, Effect, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL } from "./constants"
import { parseDeepLinksFromArgv } from "./deep-links"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import { createTray, destroyTray, getCloseToTrayEnabled, rebuildTrayMenu } from "./tray"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"
import { startBackgroundCli } from "./background-cli"
import { setNativeTranslations } from "./native-translations"
import { createSidecarSupervisor } from "./sidecar-supervisor"
import { getStore } from "./store"

const APP_NAMES: Record<string, string> = {
  dev: "CoderRupee Dev",
  beta: "CoderRupee Beta",
  prod: "CoderRupee",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.coderrupee.desktop.dev",
  beta: "ai.coderrupee.desktop.beta",
  prod: "ai.coderrupee.desktop",
}
const TEST_ONBOARDING = process.env.CODERRUPEE_TEST_ONBOARDING === "1"
const SIDECAR_VERSION = process.env.CODERRUPEE_SIDECAR_V2 === "1" ? "v2" : "v1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"
const DISPLAY_BACKEND_KEY = "displayBackend"
type DisplayBackend = "wayland" | "auto"

function isDisplayBackend(value: unknown): value is DisplayBackend {
  return value === "wayland" || value === "auto"
}

function getDisplayBackend(): DisplayBackend | null {
  const value = getStore().get<string>(DISPLAY_BACKEND_KEY)
  return isDisplayBackend(value) ? value : null
}

// Chromium switches must be set before app ready, so a backend change takes
// effect on the relaunch triggered by setDisplayBackend (registered in main).
function applyDisplayBackendSwitch() {
  if (process.platform === "linux" && getDisplayBackend() === "wayland") {
    app.commandLine.appendSwitch("ozone-platform-hint", "auto")
  }
}

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null
let sidecarSupervisor: ReturnType<typeof createSidecarSupervisor> | undefined
let backgroundCli: { isRunning: () => Promise<boolean>; stop: () => Promise<void> } | undefined
let backgroundCliData: Awaited<ReturnType<typeof startBackgroundCli>> | undefined
let backgroundCliPoll: NodeJS.Timeout | undefined
let quitting = false

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar() {
  sidecarSupervisor?.stop()
  if (backgroundCliPoll) {
    clearInterval(backgroundCliPoll)
    backgroundCliPoll = undefined
  }
  const currentBackgroundCli = backgroundCli
  backgroundCli = undefined
  backgroundCliData = undefined
  await currentBackgroundCli?.stop().catch(() => undefined)
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.CODERRUPEE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.coderrupee.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `coderrupee-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.CODERRUPEE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "CoderRupee Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  applyDisplayBackendSwitch()
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  const shellEnv = preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = parseDeepLinksFromArgv(argv)
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    quitting = true
    setAppQuitting()
    void stopSidecars()
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void stopSidecars().finally(() => app.quit())
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("coderrupee")
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  // The tray is the background shell: it owns close-to-tray behavior and can
  // trigger the same renderer commands as the native menu.
  const quitApp = () => {
    quitting = true
    setAppQuitting()
    destroyTray()
    app.quit()
  }
  createTray({
    newSession: () => {
      const win = getLastFocusedWindow()
      win?.show()
      win?.focus()
      menuDeps.trigger("session.new")
    },
    checkForUpdates: menuDeps.checkForUpdates,
    quit: quitApp,
  })
  app.once("will-quit", () => destroyTray())
  app.on("browser-window-created", (_event, win) => {
    let sessionEnding = false
    win.on("session-end", () => {
      sessionEnding = true
    })
    win.on("show", () => rebuildTrayMenu())
    win.on("hide", () => rebuildTrayMenu())
    win.on("closed", () => rebuildTrayMenu())
    // Close-to-tray: only intercept when the setting is on and the quit is
    // not already user- or OS-initiated. The default (setting off) still
    // quits exactly as before.
    win.on("close", (event) => {
      if (quitting || sessionEnding || !getCloseToTrayEnabled()) return
      event.preventDefault()
      win.hide()
    })
  })
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => getDisplayBackend(),
    setDisplayBackend: async (backend) => {
      if (isDisplayBackend(backend)) getStore().set(DISPLAY_BACKEND_KEY, backend)
      else getStore().delete(DISPLAY_BACKEND_KEY)
      relaunch()
    },
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) {
        createMenu(menuDeps)
        rebuildTrayMenu()
      }
    },
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { version: SIDECAR_VERSION })

    ensureLoopbackNoProxy()
    useEnvProxy()

    if (SIDECAR_VERSION === "v2") {
      logger.log("spawning v2 sidecar")
      sidecarSupervisor = createSidecarSupervisor({
        start: async () => {
          backgroundCliData = await startBackgroundCli(logger, shellEnv?.XDG_STATE_HOME)
          backgroundCli = backgroundCliData
          if (!backgroundCliPoll) {
            backgroundCliPoll = setInterval(() => {
              const current = backgroundCli
              if (!current) return
              void current.isRunning().then((running) => {
                if (!running && !quitting && backgroundCli === current) {
                  backgroundCli = undefined
                  sidecarSupervisor?.notifyExit({ expected: false })
                }
              })
            }, 2_000)
            backgroundCliPoll.unref()
          }
        },
        timers: {
          set: (delay, onFire) => setTimeout(onFire, delay),
          clear: (timer) => clearTimeout(timer as NodeJS.Timeout),
        },
        log: {
          log: (message, meta) => logger.log(message, meta),
          error: (message, meta) => logger.error(message, meta),
        },
      })
      yield* Effect.promise(() => sidecarSupervisor!.start())
      const sidecar = backgroundCliData!
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const port = yield* Effect.gen(function* () {
      const fromEnv = process.env.CODERRUPEE_PORT
      if (fromEnv) {
        const parsed = Number.parseInt(fromEnv, 10)
        if (!Number.isNaN(parsed)) return parsed
      }

      const res = yield* Deferred.make<number, unknown>()
      const socket = createServer()
      socket.on("error", (e) => Deferred.failSync(res, () => e))
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address()
        if (typeof address !== "object" || !address) {
          socket.close()
          Deferred.failSync(res, () => new Error("Failed to get port"))
          return
        }
        const port = address.port
        socket.close(() => Effect.runSync(Deferred.succeed(res, port)))
      })

      return yield* Deferred.await(res)
    })
    const hostname = "127.0.0.1"
    const url = `http://${hostname}:${port}`
    const password = randomUUID()

    logger.log("spawning sidecar", { url })
    let health: { wait: Promise<void> } | undefined
    sidecarSupervisor = createSidecarSupervisor({
      start: async () => {
        let ready = false
        const spawned = await spawnLocalServer(hostname, port, password, {
          userDataPath: app.getPath("userData"),
          onStdout: (message) => writeLog("server", "stdout", { message }),
          onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
          onExit: (code) => {
            writeLog("utility", "sidecar exited", { code }, "warn")
            if (ready) sidecarSupervisor?.notifyExit({ expected: false })
          },
        })
        ready = true
        server = spawned.listener
        health = spawned.health
      },
      timers: {
        set: (delay, onFire) => setTimeout(onFire, delay),
        clear: (timer) => clearTimeout(timer as NodeJS.Timeout),
      },
      log: { log: (message, meta) => logger.log(message, meta), error: (message, meta) => logger.error(message, meta) },
    })
    yield* Effect.promise(() => sidecarSupervisor!.start())
    yield* Deferred.succeed(serverReady, {
      url,
      username: "coderrupee",
      password,
    })

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    yield* Effect.promise(() => health!.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    restoreMainWindows()
  })

  // Cold start: on Windows and Linux the shell passes coderrupee:// urls in
  // argv on first launch (macOS delivers them via open-url instead). Buffer
  // them before window creation so the renderer can consume-initial-deep-links.
  if (process.platform !== "darwin") {
    const coldStartLinks = parseDeepLinksFromArgv(process.argv)
    if (coldStartLinks.length) {
      logger.log("deep link received at cold start", { urls: coldStartLinks })
      emitDeepLinks(coldStartLinks)
    }
  }

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)
})

Effect.runFork(main)
