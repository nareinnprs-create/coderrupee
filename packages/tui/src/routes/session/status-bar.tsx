import type { AssistantMessage } from "@coderrupee/sdk/v2"
import { createMemo, Show } from "solid-js"
import { useKV } from "../../context/kv"
import { useLocal } from "../../context/local"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { branchLabel, contextUsage, costBudget, costLabel, costWarned, modelLabel } from "../../util/status-bar"

export function StatusBar(props: { sessionID: string }) {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const kv = useKV()
  const [visible] = kv.signal("session_status_bar_visible", true)

  const model = createMemo(() => modelLabel(local.model.current()))
  const context = createMemo(() => {
    const message = (sync.data.message[props.sessionID] ?? []).findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!message) return
    const limit = sync.data.provider.find((item) => item.id === message.providerID)?.models[message.modelID]?.limit
      .context
    return contextUsage(message.tokens, limit)
  })
  const sessionCost = createMemo(() => sync.session.get(props.sessionID)?.cost)
  const budget = createMemo(() => costBudget(sync.data.config))
  const cost = createMemo(() => {
    const label = costLabel(sessionCost())
    if (!label) return
    return costWarned(sessionCost(), budget()) ? `${label} ▲` : label
  })
  const branch = createMemo(() => branchLabel(sync.data.vcs?.branch))

  const segments = createMemo(() =>
    [model(), context() !== undefined ? `${context()}%` : undefined, cost(), branch()].filter(Boolean).join(" · "),
  )

  return (
    <Show when={visible() && segments()}>
      <box flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="none">
          {segments()}
        </text>
      </box>
    </Show>
  )
}
