// Pure helpers for the collapsed reasoning rows in the message timeline.

// Mirrors the TUI reasoning block: redacted placeholders are dropped and the
// remainder is trimmed before it is shown or summarized.
export const reasoningContent = (text: string | undefined) => text?.replace("[REDACTED]", "").trim() ?? ""

// A part streams until the server stamps `time.end`; while it streams the block
// stays expanded unless the user explicitly toggled it, and collapsed after.
export const reasoningExpanded = (override: boolean | undefined, streaming: boolean) => override ?? streaming
