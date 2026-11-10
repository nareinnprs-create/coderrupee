/**
 * Edit replacement search ported from upstream v2.2.7 `tool/plugin/edit.ts`.
 * Matches against the LF view Read shows the model, then maps offsets back to
 * the source, retrying while ignoring typographic quote, dash, and space
 * variants, then trailing whitespace on each line.
 */
export * as EditReplace from "./edit-replace"

export interface Match {
  readonly start: number
  readonly end: number
}

export const normalizeForMatch = (value: string) =>
  value
    .replace(/['\u2019\u201A\u201B]/g, "'")
    .replace(/["\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")

export const findOccurrences = (content: string, search: string): Match[] => {
  const result: Match[] = []
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length })
    offset += search.length
  }
  return result
}

const findLineOccurrences = (content: string, search: string): Match[] => {
  const trailingNewline = search.endsWith("\n")
  const expected = search.split("\n")
  if (trailingNewline) expected.pop()
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n")
      const text = newline ? match[0].slice(0, -1) : match[0]
      return {
        start: match.index,
        end: match.index + match[0].length,
        text,
        contentEnd: match.index + text.length - (text.endsWith("\r") ? 1 : 0),
        newline,
      }
    })
  const candidates = lines.flatMap((line, index) => {
    const actual = lines.slice(index, index + expected.length)
    if (actual.length !== expected.length) return []
    if (
      !actual.every(
        (item, lineIndex) => normalizeForMatch(item.text.trimEnd()) === normalizeForMatch(expected[lineIndex].trimEnd()),
      )
    )
      return []
    const last = actual.at(-1)!
    if (trailingNewline && !last.newline) return []
    return [{ start: line.start, end: trailingNewline ? last.end : last.contentEnd }]
  })
  return candidates.reduce<Match[]>((result, candidate) => {
    if (result.some((match) => match.end > candidate.start && match.start < candidate.end)) return result
    result.push(candidate)
    return result
  }, [])
}

/** The dominant line ending in text, or fallback when there is none. */
const lineEnding = (text: string, fallback: string) => {
  const crlfCount = text.split("\r\n").length - 1
  const lfCount = text.split("\n").length - 1 - crlfCount
  if (crlfCount === lfCount) return fallback
  return crlfCount > lfCount ? "\r\n" : "\n"
}

/**
 * Joins the replacement's lines with line endings taken from the matched source region. A replacement line that
 * keeps a region line (longest common subsequence, compared like the trailing-whitespace tier) reuses that line's
 * ending; a line that changes in place reuses the ending of the line it replaces; only lines beyond those take
 * `fallback`. Unchanged context inside a match therefore keeps its bytes even in a mixed-ending file.
 */
const withRegionEndings = (region: string, replacement: string, fallback: string) => {
  const before = region.split(/\r?\n/)
  const endings = [...region.matchAll(/\r?\n/g)].map((match) => match[0])
  const after = replacement.split("\n")
  const key = (line: string) => normalizeForMatch(line.trimEnd())
  const source = alignLines(before.map(key), after.map(key))
  return after.map((line, index) => (index === after.length - 1 ? line : line + (endings[source[index]!] ?? fallback))).join("")
}

/**
 * For each line of `after`, the index of the `before` line it keeps (longest common subsequence) or, between kept
 * lines, the line it takes the place of; undefined for lines with no counterpart.
 */
const alignLines = (before: string[], after: string[]) => {
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const result: (number | undefined)[] = []
  const gap = { before: [] as number[], after: [] as number[] }
  const flush = () => {
    gap.after.forEach((j, k) => (result[j] = gap.before[k]))
    gap.before = []
    gap.after = []
  }
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      flush()
      result[j++] = i++
      continue
    }
    if (table[(i + 1) * width + j] >= table[i * width + j + 1]) gap.before.push(i++)
    else gap.after.push(j++)
  }
  while (i < before.length) gap.before.push(i++)
  while (j < after.length) gap.after.push(j++)
  flush()
  return result
}

/**
 * Matches oldString in source exactly, then ignoring typographic variants,
 * then trailing whitespace per line. Replacement text keeps the matched
 * region's line endings; the file's endings are never rewritten.
 */
export const matchView = (source: string, oldString: string, newString: string) => {
  const view = source.replaceAll("\r\n", "\n")
  const removed = [...source.matchAll(/\r\n/g)].map((match, index) => match.index - index)
  const fileEnding = lineEnding(source, "\n")
  const search = oldString.replaceAll("\r\n", "\n")
  const replacement = newString.replaceAll("\r\n", "\n")
  const exact = findOccurrences(view, search)
  // These one-to-one mappings preserve offsets into the LF view.
  const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(view), normalizeForMatch(search))
  const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(view, search)
  return {
    matches: (exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing).map((match) => ({
      start: match.start + countBefore(removed, match.start),
      end: match.end + countBefore(removed, match.end),
    })),
    replace: (match: Match) => {
      const region = source.slice(match.start, match.end)
      return withRegionEndings(region, replacement, lineEnding(region, fileEnding))
    },
  }
}

const hintLines = 12
const hintLineLength = 200

/**
 * A short hint for an oldString miss, so the next attempt can succeed without rereading the file: newString is
 * already there (often an edit that already applied), or the lines closest to oldString, numbered like Read output.
 * Lines vote for where oldString starts when they match ignoring all whitespace; at least half must agree. Only the
 * span from the first to the last line that matched is shown, so padding oldString cannot reveal the lines after it.
 */
export const missHint = (source: string, oldString: string, newString: string) => {
  const view = source.replaceAll("\r\n", "\n")
  const replacement = newString.replaceAll("\r\n", "\n")
  if (replacement.trim().length >= 20 && normalizeForMatch(view).includes(normalizeForMatch(replacement)))
    return "newString is already in the file, so this edit may already be applied."
  const key = (line: string) => normalizeForMatch(line).replace(/\s+/g, " ").trim()
  const distinct = (line: string) => /[\p{L}\p{N}]/u.test(line)
  const lines = view.split("\n")
  const search = oldString.replaceAll("\r\n", "\n").split("\n")
  const positions = new Map<string, number[]>()
  lines.forEach((line, index) => {
    const value = key(line)
    if (!distinct(value)) return
    const found = positions.get(value)
    if (found) found.push(index)
    else positions.set(value, [index])
  })
  const votes = new Map<number, number>()
  const wanted = search.filter((line, offset) => {
    const value = key(line)
    if (!distinct(value)) return false
    for (const index of positions.get(value) ?? []) votes.set(index - offset, (votes.get(index - offset) ?? 0) + 1)
    return true
  }).length
  const [start, count] = [...votes].reduce((best, vote) => (vote[1] > best[1] ? vote : best), [0, 0])
  if (count === 0 || count * 2 < wanted) return undefined
  const matched = search.flatMap((line, offset) => {
    const value = key(line)
    const index = start + offset
    return value !== "" && index >= 0 && index < lines.length && key(lines[index]) === value ? [index] : []
  })
  const from = matched[0]
  if (from === undefined) return undefined
  const to = Math.min(matched.at(-1)! + 1, from + hintLines)
  return [
    "The closest lines in the file:",
    ...lines
      .slice(from, to)
      .map(
        (line, index) =>
          `${from + index + 1}: ${line.length > hintLineLength ? `${line.slice(0, hintLineLength)}…` : line}`,
      ),
  ].join("\n")
}

/** Number of sorted positions strictly before offset. */
const countBefore = (positions: number[], offset: number) => {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (positions[middle] < offset) low = middle + 1
    else high = middle
  }
  return low
}
