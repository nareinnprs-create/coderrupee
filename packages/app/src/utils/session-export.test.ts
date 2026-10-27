import { describe, expect, test } from "bun:test"
import {
  buildSessionExportHtml,
  buildSessionExportMarkdown,
  fetchSessionExport,
  sessionExportDocument,
  sessionExportFilename,
} from "./session-export"
import type { Message, Part, Session } from "@coderrupee/sdk/v2/client"

describe("sessionExportFilename", () => {
  test("generates filename from title", () => {
    expect(sessionExportFilename({ id: "ses_123", title: "Clone PR in worktree from fork" })).toBe(
      "clone-pr-in-worktree-from-fork.json",
    )
  })

  test("generates filename from slug when title missing", () => {
    expect(sessionExportFilename({ id: "ses_123", slug: "my-session-slug" })).toBe("my-session-slug.json")
  })

  test("falls back to id when title and slug are empty", () => {
    expect(sessionExportFilename({ id: "ses_123" })).toBe("ses_123.json")
  })
})

describe("fetchSessionExport", () => {
  test("fetches full transcript from client", async () => {
    const session = { id: "ses_1", title: "Test Session" } as Session
    const msg = { id: "msg_1", role: "user" } as Message
    const part = { id: "prt_1", type: "text", text: "hello" } as Part
    const messages = [{ info: msg, parts: [part] }]

    const client = {
      session: {
        get: async () => ({ data: session }),
        messages: async () => ({ data: messages }),
      },
    }

    const result = await fetchSessionExport({
      sessionID: "ses_1",
      client,
    })

    expect(result).toEqual({
      info: session,
      messages,
    })
  })

  test("throws when session not found", async () => {
    const client = {
      session: {
        get: async () => ({ data: null }),
        messages: async () => ({ data: [] }),
      },
    }

    expect(
      fetchSessionExport({
        sessionID: "ses_missing",
        client,
      }),
    ).rejects.toThrow("Session not found: ses_missing")
  })
})

const fixtureSession = {
  id: "ses_fix",
  slug: "fix-login-bug",
  title: "Fix <login> bug",
  agent: "build",
  cost: 0.5,
  model: { id: "model-x", providerID: "provider-y" },
  time: { created: 1761651600000, updated: 1761651700000 },
} as Session

const fixtureMessages = [
  {
    info: { id: "msg_1", role: "user", time: { created: 1761651601000 } } as Message,
    parts: [
      { id: "prt_1", type: "text", text: "Please fix the login bug" } as Part,
      { id: "prt_2", type: "file", filename: "login.ts", url: "file:///login.ts" } as Part,
    ],
  },
  {
    info: { id: "msg_2", role: "assistant", time: { created: 1761651602000 } } as Message,
    parts: [
      { id: "prt_3", type: "reasoning", text: "Thinking about <root> cause" } as Part,
      { id: "prt_4", type: "text", text: "Reading the file now" } as Part,
      {
        id: "prt_5",
        type: "tool",
        tool: "read",
        state: {
          status: "completed",
          title: "Read login.ts",
          input: {},
          // Script injection first so it survives output truncation; padding forces the marker.
          output: `<script>alert(1)</script>${"x".repeat(3000)}`,
          metadata: {},
          time: { start: 1761651603000, end: 1761651604000 },
        },
      } as Part,
    ],
  },
]

const fixture = { info: fixtureSession, messages: fixtureMessages }
const userTime = new Date(1761651601000).toISOString()
const assistantTime = new Date(1761651602000).toISOString()

describe("buildSessionExportMarkdown", () => {
  test("renders session title and metadata header", () => {
    const markdown = buildSessionExportMarkdown(fixture)
    expect(markdown).toContain("# Fix <login> bug")
    expect(markdown).toContain("- Session: `ses_fix`")
    expect(markdown).toContain("- Model: provider-y/model-x")
    expect(markdown).toContain("- Agent: build")
  })

  test("renders messages as role + timestamp sections", () => {
    const markdown = buildSessionExportMarkdown(fixture)
    expect(markdown).toContain(`## User — ${userTime}`)
    expect(markdown).toContain(`## Assistant — ${assistantTime}`)
  })

  test("keeps assistant text as markdown and lists files", () => {
    const markdown = buildSessionExportMarkdown(fixture)
    expect(markdown).toContain("Reading the file now")
    expect(markdown).toContain("- File: login.ts")
  })

  test("wraps reasoning in collapsible details blocks", () => {
    const markdown = buildSessionExportMarkdown(fixture)
    expect(markdown).toContain("<details>\n<summary>Reasoning</summary>\n\nThinking about <root> cause\n\n</details>")
  })

  test("renders tool calls as compact subsections with truncation marker", () => {
    const markdown = buildSessionExportMarkdown(fixture)
    expect(markdown).toContain("### Tool: read")
    expect(markdown).toContain("- Status: completed")
    expect(markdown).toContain("- Summary: Read login.ts")
    expect(markdown).toContain("[...truncated, 1025 more characters...]")
  })
})

describe("buildSessionExportHtml", () => {
  test("renders a standalone document with title, style, and meta", () => {
    const html = buildSessionExportHtml(fixture)
    expect(html).toStartWith("<!doctype html>")
    expect(html).toContain("<style>")
    expect(html).toContain("prefers-color-scheme")
    expect(html).toContain("max-width: 46rem")
    expect(html).toContain("<title>Fix &lt;login&gt; bug</title>")
    expect(html).toContain("provider-y/model-x")
  })

  test("renders role + timestamp sections and reasoning details", () => {
    const html = buildSessionExportHtml(fixture)
    expect(html).toContain(`<span class="role">User</span><time>${userTime}</time>`)
    expect(html).toContain(`<span class="role">Assistant</span><time>${assistantTime}</time>`)
    expect(html).toContain("<details>")
    expect(html).toContain("<summary>Reasoning</summary>")
    expect(html).toContain("Thinking about &lt;root&gt; cause")
  })

  test("escapes all interpolated content, including script tags", () => {
    const html = buildSessionExportHtml(fixture)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("Fix &lt;login&gt; bug")
  })

  test("renders tool sections with truncation marker", () => {
    const html = buildSessionExportHtml(fixture)
    expect(html).toContain("Tool: read")
    expect(html).toContain("Status: completed")
    expect(html).toContain("[...truncated, 1025 more characters...]")
  })
})

describe("sessionExportDocument", () => {
  test("json format is byte-identical to JSON.stringify(data, null, 2)", () => {
    const document = sessionExportDocument(fixture, "json")
    expect(document.body).toBe(JSON.stringify(fixture, null, 2))
    expect(document.type).toBe("application/json")
  })

  test("markdown format produces a text/markdown document", () => {
    const document = sessionExportDocument(fixture, "markdown")
    expect(document.type).toBe("text/markdown;charset=utf-8")
    expect(document.body).toBe(buildSessionExportMarkdown(fixture))
  })

  test("html format produces a text/html document", () => {
    const document = sessionExportDocument(fixture, "html")
    expect(document.type).toBe("text/html;charset=utf-8")
    expect(document.body).toBe(buildSessionExportHtml(fixture))
  })
})
