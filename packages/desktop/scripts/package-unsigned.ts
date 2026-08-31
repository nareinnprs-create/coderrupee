#!/usr/bin/env bun
import { $ } from "bun"

process.env.CODERRUPEE_CHANNEL = "prod"
process.env.CODERRUPEE_UNSIGNED = "1"

const flags = process.argv.slice(2)
if (flags.length === 0) {
  await $`bun x electron-builder --config electron-builder.config.ts`
} else {
  await $`bun x electron-builder ${flags} --config electron-builder.config.ts`
}
