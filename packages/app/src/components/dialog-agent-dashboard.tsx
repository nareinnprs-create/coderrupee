import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useDialog } from "@coderrupee/ui/context/dialog"
import { Dialog } from "@coderrupee/ui/dialog"
import { IconButton } from "@coderrupee/ui/icon-button"
import { Spinner } from "@coderrupee/ui/spinner"
import { DialogBody, DialogHeader, DialogTitleGroup, DialogV2 } from "@coderrupee/ui/v2/dialog-v2"
import { useData } from "@coderrupee/session-ui/context"
import { durationParts } from "@coderrupee/session-ui/duration"
import { getToolInfo } from "@coderrupee/session-ui/message-part"
import { latestTaskActivity } from "@coderrupee/session-ui/task-activity"
import type { Part } from "@coderrupee/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import {
  agentActions,
  buildAgentTree,
  collectTaskSeeds,
  flattenAgentRows,
  type AgentNode,
  type AgentNodeStatus,
} from "@/pages/session/agent-tree"

// Read-only multi-agent dashboard. The session.agents command and the header
// button lazy-import this module, so a closed dashboard costs nothing. Child
// data arrives through the shared sync layer: the running-agent sync effect on
// the session timeline provisions it, and this panel only reads the store -
// no second sync path.
export function DialogAgentDashboard(props: { sessionID: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()

  if (settings.general.newLayoutDesigns())
    return (
      <DialogV2 fit>
        <DialogHeader>
          <DialogTitleGroup
            title={language.t("dialog.agents.title")}
            description={language.t("dialog.agents.description")}
          />
        </DialogHeader>
        <DialogBody>
          <AgentDashboardBody sessionID={props.sessionID} />
        </DialogBody>
      </DialogV2>
    )

  return (
    <Dialog title={language.t("dialog.agents.title")} description={language.t("dialog.agents.description")} fit>
      <div class="flex flex-col gap-3 pl-6 pr-2.5 pb-3">
        <AgentDashboardBody sessionID={props.sessionID} />
      </div>
    </Dialog>
  )
}

const statusKey: Record<AgentNodeStatus, string> = {
  queued: "dialog.agents.status.queued",
  running: "dialog.agents.status.running",
  completed: "dialog.agents.status.completed",
  failed: "dialog.agents.status.failed",
}

const AgentDashboardBody = (props: { sessionID: string }) => {
  const data = useData()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const partsOf = (messageID: string) => sync().data.part[messageID]
  const childSnapshot = (sessionID: string) => {
    const info = sync().session.get(sessionID)
    return {
      title: info?.title,
      cost: info?.cost,
      model: info?.model ? `${info.model.providerID}/${info.model.id}` : undefined,
      status: sync().data.session_status[sessionID]?.type,
      tasks: collectTaskSeeds(sync().data.message[sessionID], partsOf),
    }
  }
  const seeds = createMemo(() => collectTaskSeeds(sync().data.message[props.sessionID], partsOf))
  const tree = createMemo(() => {
    const children: Record<string, ReturnType<typeof childSnapshot>> = {}
    for (const item of seeds()) {
      if (!item.sessionID) continue
      children[item.sessionID] = childSnapshot(item.sessionID)
    }
    return buildAgentTree({ seeds: seeds(), children, rootSessionID: props.sessionID }, now())
  })
  const rows = createMemo(() => flattenAgentRows(tree().nodes))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))

  const open = (node: AgentNode) => {
    if (!node.sessionID || !data.navigateToSession) return
    dialog.close()
    data.navigateToSession(node.sessionID)
  }

  const cancel = (node: AgentNode) => {
    if (!node.sessionID) return
    data.abortSession?.(node.sessionID)
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-4 text-12-regular text-text-weak">
        <span>
          {language.t("dialog.agents.stats.agents")}: {tree().stats.total}
        </span>
        <span>
          {language.t("dialog.agents.stats.running")}: {tree().stats.running}
        </span>
        <span>
          {language.t("dialog.agents.stats.spend")}: {usd().format(tree().stats.totalCost)}
        </span>
      </div>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex items-center justify-center py-8 text-12-regular text-text-weaker">
            {language.t("dialog.agents.empty")}
          </div>
        }
      >
        <div class="flex flex-col gap-1 max-h-[420px] overflow-y-auto" role="list">
          <For each={rows()}>
            {(row) => (
              <AgentRowItem
                node={row.node}
                depth={row.depth}
                partsOf={partsOf}
                usd={usd()}
                onCancel={() => cancel(row.node)}
                onOpen={() => open(row.node)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const AgentRowItem = (props: {
  node: AgentNode
  depth: number
  partsOf: (messageID: string) => Part[] | undefined
  usd: Intl.NumberFormat
  onCancel: () => void
  onOpen: () => void
}) => {
  const data = useData()
  const sync = useSync()
  const language = useLanguage()

  // Same newest-tool-label policy as the live task cards; the line stays
  // absent when the child session has not been synced.
  const activity = createMemo(() => {
    if (props.node.status !== "running" || !props.node.sessionID) return
    const messages = sync().data.message[props.node.sessionID]
    if (!messages?.length) return
    return latestTaskActivity(messages, props.partsOf, (part) => {
      if (part.type !== "tool" || part.tool === "todowrite") return
      return getToolInfo(part.tool, part.state.input, "metadata" in part.state ? part.state.metadata : undefined).title
    })
  })

  const duration = createMemo(() => {
    const ms = props.node.durationMs
    if (ms === undefined) return
    const parts = durationParts(ms)
    return parts.kind === "seconds"
      ? language.t("ui.message.duration.seconds", { count: parts.count })
      : language.t("ui.message.duration.minutesSeconds", { minutes: parts.minutes, seconds: parts.seconds })
  })

  const actions = createMemo(() =>
    agentActions(props.node, { canAbort: !!data.abortSession, canNavigate: !!data.navigateToSession }),
  )

  return (
    <div
      role="listitem"
      class="flex flex-col gap-0.5 rounded-md border border-border-weak-base bg-surface-panel px-2 py-1.5"
      style={{ "margin-left": `${props.depth * 16}px` }}
    >
      <div class="flex items-center gap-2 min-w-0">
        <Show when={props.node.status === "running"} fallback={<StatusDot status={props.node.status} />}>
          <Spinner class="size-3 shrink-0" />
        </Show>
        <span class="text-12-regular text-text-strong truncate flex-1 min-w-0">{props.node.title}</span>
        <span class="text-11-regular text-text-weaker shrink-0">{language.t(statusKey[props.node.status])}</span>
        <Show when={actions().cancel}>
          <IconButton
            icon="stop"
            variant="ghost"
            size="small"
            iconSize="small"
            class="shrink-0"
            aria-label={language.t("ui.common.cancel")}
            onClick={() => props.onCancel()}
          />
        </Show>
        <Show when={actions().open}>
          <IconButton
            icon="square-arrow-top-right"
            variant="ghost"
            size="small"
            iconSize="small"
            class="shrink-0"
            aria-label={language.t("dialog.agents.action.open")}
            onClick={() => props.onOpen()}
          />
        </Show>
      </div>
      <Show
        when={activity() || duration() || props.node.error || props.node.model || props.node.cost !== undefined}
      >
        <div class="flex items-center gap-3 pl-5 text-11-regular text-text-weaker min-w-0">
          <Show when={activity()}>
            {(value) => <span class="truncate min-w-0">{value()}</span>}
          </Show>
          <Show when={duration()}>
            {(value) => <span class="shrink-0">{value()}</span>}
          </Show>
          <Show when={props.node.error}>
            {(value) => <span class="truncate min-w-0">{value()}</span>}
          </Show>
          <Show when={props.node.model}>
            {(value) => <span class="shrink-0">{value()}</span>}
          </Show>
          <Show when={props.node.cost !== undefined}>
            <span class="shrink-0">{props.usd.format(props.node.cost ?? 0)}</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const StatusDot = (props: { status: AgentNodeStatus }) => (
  <span
    class="size-2 shrink-0 rounded-full"
    classList={{
      "bg-text-weaker": props.status === "queued",
      "bg-icon-success-base": props.status === "completed",
      "bg-icon-critical-base": props.status === "failed",
    }}
    aria-hidden="true"
  />
)
