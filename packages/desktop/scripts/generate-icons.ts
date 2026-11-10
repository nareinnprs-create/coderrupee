#!/usr/bin/env bun

// Renders the CoderRupee brand emblem into every icon raster the desktop package
// and the app favicons need. Regenerate with:
//   bun packages/desktop/scripts/generate-icons.ts <emblem.svg> <output-root> [...more root pairs]

import { mkdir, readdir } from "fs/promises"
import path from "path"

type SharpInstance = {
  resize(width: number, height: number): {
    toBuffer(): Promise<Buffer>
    extend(top: number, right: number, bottom: number, left: number): { png(): { toBuffer(): Promise<Buffer> } }
    composite(layers: Array<{ input: Buffer; gravity: string }>): { png(): { toBuffer(): Promise<Buffer> } }
  }
}
type SharpModule = (input: Buffer, options?: { density?: number }) => SharpInstance

// sharp lives in the Bun store, not in any package's dependencies; resolve it there.
const sharpStorePath = "../../../node_modules/.bun/sharp@0.33.5/node_modules/sharp"
const sharpModule = await import(sharpStorePath).catch(() => import("sharp"))
const sharp = ((sharpModule as { default?: SharpModule }).default ?? (sharpModule as SharpModule)) as SharpModule

const args = process.argv.slice(2)
if (args.length < 2 || args.length % 2 !== 0) {
  console.log("usage: generate-icons.ts <emblem.svg> <output-root> [<emblem.svg> <output-root>...]")
  process.exit(1)
}

const pairs: Array<{ emblem: string; root: string }> = []
for (let i = 0; i < args.length; i += 2) pairs.push({ emblem: path.resolve(args[i]), root: path.resolve(args[i + 1]) })

const androidLauncher = new Map([
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
])
const androidForeground = new Map([
  ["mipmap-mdpi", 108],
  ["mipmap-hdpi", 162],
  ["mipmap-xhdpi", 216],
  ["mipmap-xxhdpi", 324],
  ["mipmap-xxxhdpi", 432],
])

async function iconSet(emblemPath: string, root: string) {
  const svg = Buffer.from(await Bun.file(emblemPath).text())

  // Rasterize large once (300dpi ≈ 4167px for a 1000-unit viewBox), then downscale per target.
  const render = (size: number) => sharp(svg, { density: 300 }).resize(size, size).toBuffer()

  const renderInset = async (size: number) => {
    // Adaptive launcher icons need the mark inset inside the 108-unit foreground canvas.
    const mark = Math.round(size * 0.6)
    const pad = size - mark
    const left = Math.floor(pad / 2)
    const top = Math.floor(pad / 2)
    return sharp(svg, { density: 300 })
      .resize(mark, mark)
      .extend(top, pad - left, pad - top, left)
      .png()
      .toBuffer()
  }

  const writePng = async (relative: string, data: Buffer) => {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, data)
  }

  const png = async (relative: string, size: number) => {
    await writePng(relative, await render(size))
  }

  async function writeIco() {
    const sizes = [16, 24, 32, 48, 64, 128, 256]
    const pngs = await Promise.all(sizes.map((size) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer()))
    const images = pngs.map((data, i) => ({ width: sizes[i], height: sizes[i], data }))
    const header = Buffer.alloc(6)
    header.writeUInt16LE(0, 0)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(images.length, 4)
    let cursor = 6 + images.length * 16
    const entries: Buffer[] = []
    for (const image of images) {
      const entry = Buffer.alloc(16)
      entry.writeUInt8(image.width >= 256 ? 0 : image.width, 0)
      entry.writeUInt8(image.height >= 256 ? 0 : image.height, 1)
      entry.writeUInt16LE(1, 4)
      entry.writeUInt16LE(32, 6)
      entry.writeUInt32LE(image.data.length, 8)
      entry.writeUInt32LE(cursor, 12)
      entries.push(entry)
      cursor += image.data.length
    }
    await Bun.write(
      path.join(root, "icon.ico"),
      Buffer.concat([header, ...entries, ...images.map((image) => image.data)]),
    )
  }

  async function writeIcns() {
    const types: Array<[string, number]> = [
      ["icp4", 16],
      ["icp5", 32],
      ["ic07", 128],
      ["ic08", 256],
      ["ic09", 512],
      ["ic10", 1024],
    ]
    const chunks: Buffer[] = []
    for (const [type, size] of types) {
      const data = await sharp(svg, { density: 300 }).resize(size, size).png().toBuffer()
      const chunk = Buffer.alloc(8 + data.length)
      chunk.write(type, 0, "ascii")
      chunk.writeUInt32BE(data.length + 8, 4)
      Buffer.from(data).copy(chunk, 8)
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    const header = Buffer.alloc(8)
    header.write("icns", 0, "ascii")
    header.writeUInt32BE(body.length + 8, 4)
    await Bun.write(path.join(root, "icon.icns"), Buffer.concat([header, body]))
  }

  await png("icon.png", 1024)
  await png("128x128.png", 128)
  await png("128x128@2x.png", 256)
  await png("32x32.png", 32)
  await png("64x64.png", 64)
  await png("Square30x30Logo.png", 30)
  await png("Square44x44Logo.png", 44)
  await png("Square71x71Logo.png", 71)
  await png("Square89x89Logo.png", 89)
  await png("Square107x107Logo.png", 107)
  await png("Square142x142Logo.png", 142)
  await png("Square150x150Logo.png", 150)
  await png("Square284x284Logo.png", 284)
  await png("Square310x310Logo.png", 310)
  await png("StoreLogo.png", 50)
  await png("dock.png", 512)
  await writeIco()
  await writeIcns()

  for (const [dir, size] of androidLauncher) {
    await png(path.join("android", dir, "ic_launcher.png"), size)
    await png(path.join("android", dir, "ic_launcher_round.png"), size)
    await writePng(path.join("android", dir, "ic_launcher_foreground.png"), await renderInset(androidForeground.get(dir) ?? size * 2))
  }

  const iosDir = path.join(root, "ios")
  const iosFiles = await readdir(iosDir).catch(() => [])
  for (const file of iosFiles) {
    if (!file.endsWith(".png")) continue
    const scale = file.includes("@2x") ? 2 : file.includes("@3x") ? 3 : 1
    const pt = Number(file.match(/(\d+(?:\.\d+)?)x\d+/)?.[1] ?? 0)
    if (!pt) continue
    await writePng(path.join("ios", file), await render(Math.round(pt * scale)))
  }
  console.log("icons written to", path.relative(process.cwd(), root))
}

for (const pair of pairs) await iconSet(pair.emblem, pair.root)

// Favicons always follow the first emblem pair.
{
  const appPublicDir = path.resolve(import.meta.dirname, "../../app/public")
  const svg = await Bun.file(pairs[0].emblem).text()
  await mkdir(appPublicDir, { recursive: true })
  await Bun.write(path.join(appPublicDir, "favicon-v3.svg"), svg)
  await Bun.write(path.join(appPublicDir, "favicon-96x96-v3.png"), await sharp(Buffer.from(svg), { density: 300 }).resize(96, 96).png().toBuffer())
  await Bun.write(path.join(appPublicDir, "apple-touch-icon-v3.png"), await sharp(Buffer.from(svg), { density: 300 }).resize(180, 180).png().toBuffer())
  console.log("app favicons written")
}
