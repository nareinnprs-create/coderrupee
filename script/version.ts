#!/usr/bin/env bun

import { Script } from "@coderrupee/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()

if (!Script.preview) {
  await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd())
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await Bun.file(file)
    .text()
    .catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/coderrupee-release-notes.txt`
  await Bun.write(notesFile, body)
  // Re-dispatch tolerance: the release may already exist (e.g. npm retry after
  // a token failure); reuse it instead of failing on create.
  const existing = await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.nothrow()
  if (existing.exitCode === 0) {
    const release = await existing.json()
    output.push(`release=${release.databaseId}`)
    output.push(`tag=${release.tagName}`)
  } else {
    await $`gh release create v${Script.version} -d --target ${sha} --title "CoderRupee v${Script.version}" --notes-file ${notesFile}`
    const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
    output.push(`release=${release.databaseId}`)
    output.push(`tag=${release.tagName}`)
  }
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
