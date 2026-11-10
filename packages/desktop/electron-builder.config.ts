import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "coderrupee-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.coderrupee.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "coderrupee-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/coderrupee-desktop.desktop`

// rpmbuild adds /usr/lib/.build-id links for every ELF file. The bundled Electron
// binaries are byte-identical across apps on the same Electron version, so those
// links collide with other Electron RPMs (Slack, Unity Hub, ...) and rpm/zypper
// refuse to install or update. They only serve debuginfo lookup, so skip them.
// fpm only accepts flags before the first src=dest mapping, so keep this first.
const rpmNoBuildIdLinksFpm = "--rpm-rpmbuild-define=_build_id_links none"

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

// Every @lydell/node-pty-* optional dependency bun installed; only the one
// electron-vite externalized for this build host (`@lydell/node-pty-` +
// `${process.platform}-${process.arch}`, the same expression as in
// electron.vite.config.ts) is imported by out/main — the rest are dead weight.
const nodePtyVariants = Object.keys(
  JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).optionalDependencies as Record<string, string>,
).filter((name) => name.startsWith("@lydell/node-pty-"))
const nodePtyExcludes = nodePtyVariants
  .filter((name) => name !== `@lydell/node-pty-${process.platform}-${process.arch}`)
  .map((name) => `!**/node_modules/${name}{,/**/*}`)

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.CODERRUPEE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const unsigned = process.env.CODERRUPEE_UNSIGNED === "1"

const APP_IDS = {
  dev: "ai.coderrupee.desktop.dev",
  beta: "ai.coderrupee.desktop.beta",
  prod: "ai.coderrupee.desktop",
} as const

// libappimage (used by AppImageLauncher) resolves the .desktop entry inside an
// AppImage by globbing `*.desktop` at the squashfs root. If the main
// executable itself ends in `.desktop` (prod appId `ai.coderrupee.desktop`), the
// ELF binary matches the glob and is parsed as a desktop entry, so
// integration fails with `Malformed desktop entry: Unexpected char '\x7f' at 0`
// (0x7F is the first byte of the ELF magic).
// Strip a trailing `.desktop` so the executable can never collide with the
// desktop-entry glob. Beta/dev appIds end in `.beta`/`.dev` and are unaffected.
function linuxExecutableName(appId: string): string {
  return appId.replace(/\.desktop$/, "")
}

const getBase = (appId: string): Configuration => ({
  artifactName: "coderrupee-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.coderrupee.desktop" becomes
  // "ai.coderrupee.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: [
    "out/**/*",
    "resources/**/*",
    "!resources/coderrupee-cli*",
    ...nodePtyExcludes,
    // Log export imports Zip.js as ESM. Keep index.js and lib, including its inline worker.
    "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
    "!**/node_modules/@zip.js/zip.js/{index.cjs,index.min.js,index-fflate.js,deno.json,eslint.config.mjs}",
    // Nothing executes type declarations or source maps, and every entry costs startup time: the
    // main process parses the whole asar header before it runs any JavaScript.
    "!**/node_modules/**/*.d.{ts,cts,mts}",
    "!**/node_modules/**/*.d.{ts,cts,mts}.map",
    "!**/node_modules/**/*.{js,cjs,mjs}.map",
    // These packages execute compiled JavaScript, not their sources.
    "!**/node_modules/ajv/lib{,/**/*}",
    "!**/node_modules/ajv-formats/src{,/**/*}",
    // Keep js-yaml's CommonJS sources and dist/js-yaml.mjs ESM entry, not browser bundles or its CLI.
    "!**/node_modules/js-yaml/dist/{js-yaml.js,js-yaml.min.js,*.map}",
    "!**/node_modules/js-yaml/bin{,/**/*}",
  ],
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["coderrupee-cli*"],
          },
        ]
      : []),
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    extendInfo: {
      // TCC usage strings for the entitlements we request (audio-input) and the
      // folders the app can open or save to. English-only: static Info.plist metadata.
      NSMicrophoneUsageDescription: "CoderRupee needs microphone access for voice dictation.",
      NSDocumentsFolderUsageDescription: "CoderRupee needs access to your documents to open and save files.",
      NSDesktopFolderUsageDescription: "CoderRupee needs access to your desktop to open and save files.",
      NSDownloadsFolderUsageDescription: "CoderRupee needs access to your downloads to open and save files.",
      NSNetworkVolumesUsageDescription: "CoderRupee needs access to network volumes to open and save files.",
      NSRemovableVolumesUsageDescription: "CoderRupee needs access to removable volumes to open and save files.",
    },
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: !unsigned,
    identity: unsigned ? null : undefined,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: !unsigned,
  },
  protocols: {
    name: "CoderRupee",
    schemes: ["coderrupee"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    ...(unsigned
      ? { signAndEditExecutable: false }
      : {
          signtoolOptions: {
            certificateSubjectName: "Opraiz Technology Pvt Ltd",
            sign: signWindows,
          },
        }),
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    include: path.join(packageDir, "resources", "windows", "installer.nsh"),
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: linuxExecutableName(appId),
    // Derive the installed `.desktop` filename from `desktopName`
    // (`ai.coderrupee.desktop.desktop` for prod) instead of `executableName`,
    // so window association is unaffected by the executable rename above.
    syncDesktopName: true,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "CoderRupee Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "coderrupee-dev", fpm: [rpmNoBuildIdLinksFpm, metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "CoderRupee Beta",
        protocols: { name: "CoderRupee Beta", schemes: ["coderrupee"] },
        publish: { provider: "github", owner: "nareinnprs-create", repo: "coderrupee", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "coderrupee-beta", fpm: [rpmNoBuildIdLinksFpm, metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "CoderRupee",
        protocols: { name: "CoderRupee", schemes: ["coderrupee"] },
        publish: { provider: "github", owner: "nareinnprs-create", repo: "coderrupee", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "coderrupee", fpm: [rpmNoBuildIdLinksFpm, metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
