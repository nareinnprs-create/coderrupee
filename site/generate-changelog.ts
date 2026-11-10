#!/usr/bin/env bun

// Generates changelog.json for coderrupee.opraiz.com from GitHub release bodies.
// Shape must satisfy packages/app/src/context/highlights.tsx (releases[].highlights[].source includes "desktop").

const repo = process.env.CODERRUPEE_CHANGELOG_REPO ?? "nareinnprs-create/coderrupee"
const outFile = process.argv[2] ?? "site/out/changelog.json"
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
if (token) headers.Authorization = `Bearer ${token}`

const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, { headers })
if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`)
const releases = (await response.json()) as Array<{
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  body?: string
}>

function highlightsFromBody(body: string | undefined) {
  if (!body) return []
  const items: Array<{ title: string; description: string }> = []
  for (const line of body.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (!bullet) continue
    const text = bullet[1].trim()
    if (!text || text.startsWith("<")) continue
    const heading = text.match(/^\*\*(.+?)\*\*:?\s*(.*)$/)
    const title = heading ? heading[1].trim() : text.split(/[.:(]/)[0].trim().slice(0, 60)
    const description = (heading ? heading[2] : text).replace(/\*\*/g, "").trim() || title
    items.push({ title, description })
    if (items.length >= 8) break
  }
  return items
}

const changelog = {
  releases: releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({
      tag: (release.tag_name ?? release.name ?? "").replace(/^v/, ""),
      highlights: [
        {
          source: "desktop",
          items: highlightsFromBody(release.body),
        },
      ],
    })),
}

await Bun.write(outFile, JSON.stringify(changelog, null, 2))
console.log(`wrote ${outFile} with ${changelog.releases.length} releases`)
