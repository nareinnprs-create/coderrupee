import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/coderrupee-desktop.desktop"
const installerNsh = "resources/windows/installer.nsh"
const rpmNoBuildIdLinksFpm = "--rpm-rpmbuild-define=_build_id_links none"
const hostNodePtyPackage = `@lydell/node-pty-${process.platform}-${process.arch}`

const nodePtyPackages = Object.keys(
  (await Bun.file("package.json").json()).optionalDependencies as Record<string, string>,
).filter((name) => name.startsWith("@lydell/node-pty-"))

const channels = [
  { channel: "dev", appId: "ai.coderrupee.desktop.dev" },
  { channel: "beta", appId: "ai.coderrupee.desktop.beta" },
  { channel: "prod", appId: "ai.coderrupee.desktop" },
] as const

async function load(channel: string) {
  const previous = process.env.CODERRUPEE_CHANNEL
  process.env.CODERRUPEE_CHANNEL = channel

  const module = await import(`./electron-builder.config.ts?channel=${channel}`)
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.CODERRUPEE_CHANNEL
  else process.env.CODERRUPEE_CHANNEL = previous

  return config
}

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const config = await load(channel.channel)

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    // The executable must never end in `.desktop`: libappimage resolves the
    // AppImage's desktop entry by globbing `*.desktop`, and an ELF matching
    // that glob breaks AppImageLauncher with "Malformed desktop entry".
    expect(config.linux?.executableName).toBe(channel.appId.replace(/\.desktop$/, ""))
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    // The installed `.desktop` filename still derives from `desktopName` so
    // window association is unaffected by the executable rename above.
    expect(config.linux?.syncDesktopName).toBe(true)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })

  test(`keeps RPM build-id links out of ${channel.channel}`, async () => {
    const config = await load(channel.channel)

    // fpm rejects flags after the first src=dest mapping, so the flag must come first.
    expect(config.rpm?.fpm?.[0]).toBe(rpmNoBuildIdLinksFpm)
    expect(config.deb?.fpm).not.toContain(rpmNoBuildIdLinksFpm)
  })
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const config = await load("prod")

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("coderrupee-desktop.desktop=/usr/share/applications/coderrupee-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("coderrupee-desktop.desktop=/usr/share/applications/coderrupee-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/CoderRupee/ai.coderrupee.desktop %U")
  expect(desktop).toContain("Icon=ai.coderrupee.desktop")
  expect(desktop).toContain("StartupWMClass=ai.coderrupee.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

test("prunes declarations, maps, and browser bundles from the asar", async () => {
  const config = await load("dev")

  // One exclusion per node-pty variant except the one electron-vite externalized
  // for this build host, which out/main actually imports.
  const nodePtyExcludes = config.files?.filter(
    (pattern) => typeof pattern === "string" && pattern.startsWith("!**/node_modules/@lydell/node-pty-"),
  )
  expect(nodePtyExcludes).toHaveLength(nodePtyPackages.length - 1)
  expect(nodePtyExcludes).not.toContain(`!**/node_modules/${hostNodePtyPackage}{,/**/*}`)

  for (const pattern of [
    "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
    "!**/node_modules/**/*.d.{ts,cts,mts}",
    "!**/node_modules/**/*.{js,cjs,mjs}.map",
    "!**/node_modules/ajv/lib{,/**/*}",
    "!**/node_modules/ajv-formats/src{,/**/*}",
    "!**/node_modules/js-yaml/bin{,/**/*}",
  ]) {
    expect(config.files).toContain(pattern)
  }
})

test("does not reference the removed native extraResources", async () => {
  const config = await load("dev")

  expect(
    config.extraResources?.some(
      (entry) => typeof entry === "object" && "from" in entry && String(entry.from).startsWith("native/"),
    ),
  ).toBe(false)
})

test("wires the Windows installer hook", async () => {
  const config = await load("dev")

  expect(config.nsis?.include).toContain("resources")
  expect(config.nsis?.include).toContain("installer.nsh")
  expect(await Bun.file(installerNsh).exists()).toBe(true)

  const hook = await Bun.file(installerNsh).text()
  expect(hook).toContain("coderrupee.exe")
  expect(hook).toContain("coderrupee-cli.exe")
  expect(hook).toContain("customInit")
  expect(hook).toContain("customUnInit")
})

test("declares macOS TCC usage strings", async () => {
  const config = await load("dev")
  const extendInfo = config.mac?.extendInfo as Record<string, string>

  expect(extendInfo.NSMicrophoneUsageDescription).toContain("microphone access")
  expect(extendInfo.NSDocumentsFolderUsageDescription).toContain("CoderRupee")
  expect(extendInfo.NSDesktopFolderUsageDescription).toContain("CoderRupee")
  expect(extendInfo.NSDownloadsFolderUsageDescription).toContain("CoderRupee")
  expect(extendInfo.NSNetworkVolumesUsageDescription).toContain("CoderRupee")
  expect(extendInfo.NSRemovableVolumesUsageDescription).toContain("CoderRupee")
})

test("bundles the CLI outside the dev app archive", async () => {
  const config = await load("dev")

  expect(config.files).toContain("!resources/coderrupee-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["coderrupee-cli*"],
  })
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const config = await load(channel)

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["coderrupee-cli*"],
    })
  })
}
