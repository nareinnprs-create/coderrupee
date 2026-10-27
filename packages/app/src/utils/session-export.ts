import type { Message, Part, Session } from "@coderrupee/sdk/v2/client"

// Matches the exact `{ info, messages: [{ info, parts }] }` structure produced by `coderrupee export` CLI
export type SessionExportData = {
  info: Session
  messages: {
    info: Message
    parts: Part[]
  }[]
}

export type SessionExportClient = {
  session: {
    get: (input: { sessionID: string }) => Promise<{ data?: Session | null }>
    messages: (input: { sessionID: string }) => Promise<{ data?: SessionExportData["messages"] | null }>
  }
}

export async function fetchSessionExport(input: {
  sessionID: string
  client: SessionExportClient
}): Promise<SessionExportData> {
  const [sessionRes, messagesRes] = await Promise.all([
    input.client.session.get({ sessionID: input.sessionID }),
    input.client.session.messages({ sessionID: input.sessionID }),
  ])

  if (!sessionRes?.data) {
    throw new Error(`Session not found: ${input.sessionID}`)
  }
  if (!messagesRes?.data) {
    throw new Error(`Failed to load messages for session: ${input.sessionID}`)
  }

  return {
    info: sessionRes.data,
    messages: messagesRes.data,
  }
}

export type SessionExportFormat = "json" | "markdown" | "html"

export type SessionExportDocument = {
  body: string
  type: string
}

const EXPORT_MIME: Record<SessionExportFormat, string> = {
  json: "application/json",
  markdown: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
}

const EXPORT_EXTENSION: Record<SessionExportFormat, string> = {
  json: "json",
  markdown: "md",
  html: "html",
}

// Tool outputs can be enormous; keep exports readable by truncating with an explicit marker.
const TOOL_OUTPUT_LIMIT = 2000

export function sessionExportFilename(
  session: { id: string; title?: string; slug?: string },
  format: SessionExportFormat = "json",
) {
  const name = session.title || session.slug || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.${EXPORT_EXTENSION[format]}`
}

export function sessionExportDocument(data: SessionExportData, format: SessionExportFormat): SessionExportDocument {
  if (format === "markdown") return { body: buildSessionExportMarkdown(data), type: EXPORT_MIME.markdown }
  if (format === "html") return { body: buildSessionExportHtml(data), type: EXPORT_MIME.html }
  return { body: JSON.stringify(data, null, 2), type: EXPORT_MIME.json }
}

export function downloadSessionExportFile(filename: string, document: SessionExportDocument) {
  const blob = new Blob([document.body], { type: document.type })
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement("a")
  a.href = url
  a.download = filename
  window.document.body.appendChild(a)
  a.click()
  window.document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadSessionExport(filename: string, data: unknown) {
  downloadSessionExportFile(filename, sessionExportDocument(data as SessionExportData, "json"))
}

function formatTimestamp(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown"
  return new Date(value).toISOString()
}

function truncate(text: string, limit = TOOL_OUTPUT_LIMIT) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n[...truncated, ${text.length - limit} more characters...]`
}

function messageRoleLabel(role: string) {
  return role === "assistant" ? "Assistant" : "User"
}

function fence(content: string) {
  const marker = content.includes("```") ? "````" : "```"
  return `${marker}text\n${content}\n${marker}`
}

export function buildSessionExportMarkdown(data: SessionExportData) {
  const info = data.info
  const meta = [
    `- Session: \`${info.id}\``,
    `- Created: ${formatTimestamp(info.time?.created)}`,
    `- Updated: ${formatTimestamp(info.time?.updated)}`,
    info.model ? `- Model: ${info.model.providerID}/${info.model.id}` : undefined,
    info.agent ? `- Agent: ${info.agent}` : undefined,
    typeof info.cost === "number" ? `- Cost: ${info.cost}` : undefined,
  ].filter((line) => typeof line === "string")

  const messages = data.messages.map((message) => {
    const heading = `## ${messageRoleLabel(message.info.role)} — ${formatTimestamp(message.info.time?.created)}`
    const sections = message.parts.map((part) => markdownPart(part)).filter((section) => section !== undefined)
    return [heading, ...sections].join("\n\n")
  })

  return [`# ${info.title || info.id}`, "", ...meta, "", "---", "", messages.join("\n\n"), ""].join("\n")
}

function markdownPart(part: Part): string | undefined {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return undefined
    return part.text
  }
  if (part.type === "reasoning") {
    return `<details>\n<summary>Reasoning</summary>\n\n${part.text}\n\n</details>`
  }
  if (part.type === "tool") {
    const lines = [`### Tool: ${part.tool}`, "", `- Status: ${part.state.status}`]
    if (part.state.status === "completed") {
      lines.push(`- Summary: ${part.state.title}`)
      lines.push("")
      lines.push("Output:")
      lines.push("")
      lines.push(fence(truncate(part.state.output)))
    }
    if (part.state.status === "error") {
      lines.push("")
      lines.push("Error:")
      lines.push("")
      lines.push(fence(truncate(part.state.error)))
    }
    return lines.join("\n")
  }
  if (part.type === "file") {
    return `- File: ${part.filename ?? part.url}`
  }
  if (part.type === "subtask") {
    return `- Subtask: ${part.description} (${part.agent})`
  }
  return undefined
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function htmlParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `    <p>${escapeHtml(paragraph)}</p>`)
    .join("\n")
}

const HTML_STYLE = `
    body {
      margin: 0;
      background: #ffffff;
      color: #1f2328;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
      font-size: 15px;
      line-height: 1.6;
    }
    main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    header { border-bottom: 1px solid #d1d9e0; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 0.75rem; }
    dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; font-size: 0.85rem; }
    dt { color: #59636e; }
    dd { margin: 0; }
    code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; }
    section.message { border-bottom: 1px solid #d1d9e0; padding: 1rem 0 1.25rem; }
    section.message:last-child { border-bottom: none; }
    h2 { font-size: 1rem; margin: 0 0 0.5rem; }
    h2 .role { font-weight: 600; }
    h2 time { font-weight: 400; font-size: 0.8rem; color: #59636e; margin-left: 0.5rem; }
    section.message.user h2 .role { color: #59636e; }
    p { margin: 0 0 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    p:last-child { margin-bottom: 0; }
    details { margin: 0.5rem 0; }
    summary { cursor: pointer; font-size: 0.85rem; color: #59636e; }
    .reasoning { font-size: 0.85rem; color: #59636e; border-left: 3px solid #d1d9e0; padding-left: 0.75rem; margin-top: 0.5rem; }
    section.tool { margin: 0.75rem 0 0; padding: 0.5rem 0.75rem; border: 1px solid #d1d9e0; border-radius: 6px; }
    section.tool h3 { font-size: 0.85rem; margin: 0 0 0.25rem; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
    section.tool ul { margin: 0 0 0.5rem; padding-left: 1.25rem; font-size: 0.8rem; color: #59636e; }
    pre {
      background: #f6f8fa;
      border-radius: 6px;
      padding: 0.75rem;
      overflow-x: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.8rem;
      line-height: 1.5;
      margin: 0;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e6e6e6; }
      header, section.message { border-bottom-color: #333; }
      dt, h2 time, section.message.user h2 .role, summary, .reasoning, section.tool ul { color: #9198a1; }
      .reasoning { border-left-color: #333; }
      section.tool { border-color: #333; }
      pre { background: #252525; }
    }
`

export function buildSessionExportHtml(data: SessionExportData) {
  const info = data.info
  const title = info.title || info.id
  const meta = [
    ["Session", `<code>${escapeHtml(info.id)}</code>`],
    ["Created", escapeHtml(formatTimestamp(info.time?.created))],
    ["Updated", escapeHtml(formatTimestamp(info.time?.updated))],
    info.model ? ["Model", escapeHtml(`${info.model.providerID}/${info.model.id}`)] : undefined,
    info.agent ? ["Agent", escapeHtml(info.agent)] : undefined,
    typeof info.cost === "number" ? ["Cost", escapeHtml(String(info.cost))] : undefined,
  ].filter((row): row is string[] => Array.isArray(row))

  const messages = data.messages.map((message) => {
    const role = messageRoleLabel(message.info.role)
    const body = message.parts
      .map((part) => htmlPart(part))
      .filter((section) => section !== undefined)
      .join("\n")
    return [
      `  <section class="message ${escapeHtml(message.info.role)}">`,
      `    <h2><span class="role">${role}</span><time>${escapeHtml(formatTimestamp(message.info.time?.created))}</time></h2>`,
      body,
      `  </section>`,
    ].join("\n")
  })

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${HTML_STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    "<header>",
    `<h1>${escapeHtml(title)}</h1>`,
    "<dl>",
    ...meta.flatMap((row) => [`<dt>${row[0]}</dt>`, `<dd>${row[1]}</dd>`]),
    "</dl>",
    "</header>",
    ...messages,
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n")
}

function htmlPart(part: Part): string | undefined {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return undefined
    return htmlParagraphs(part.text)
  }
  if (part.type === "reasoning") {
    return [
      "    <details>",
      "      <summary>Reasoning</summary>",
      `      <div class="reasoning">${htmlParagraphs(part.text)}</div>`,
      "    </details>",
    ].join("\n")
  }
  if (part.type === "tool") {
    const meta = [`<li>Status: ${escapeHtml(part.state.status)}</li>`]
    if (part.state.status === "completed") meta.push(`<li>Summary: ${escapeHtml(part.state.title)}</li>`)
    const output =
      part.state.status === "completed"
        ? `<pre>${escapeHtml(truncate(part.state.output))}</pre>`
        : part.state.status === "error"
          ? `<pre>${escapeHtml(truncate(part.state.error))}</pre>`
          : undefined
    return [
      `    <section class="tool">`,
      `      <h3>Tool: ${escapeHtml(part.tool)}</h3>`,
      `      <ul>${meta.join("")}</ul>`,
      ...(output ? [output] : []),
      "    </section>",
    ].join("\n")
  }
  if (part.type === "file") {
    return `    <p>File: ${escapeHtml(part.filename ?? part.url)}</p>`
  }
  if (part.type === "subtask") {
    return `    <p>Subtask: ${escapeHtml(part.description)} (${escapeHtml(part.agent)})</p>`
  }
  return undefined
}
