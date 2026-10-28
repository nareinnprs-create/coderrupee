import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import {
  isVersionGreater,
  type ChannelInfo,
  type UpdateChannel,
  type UpdateState,
  type UpdateTarget,
} from "../context/update-notification"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

type Version = { current: string; latest?: string }

// A newer release in the installed major version is a normal update; anything else offers nothing.
export function updateTarget(version: Version): UpdateTarget | undefined {
  if (version.latest && isUpdate(version.current, version.latest)) return { type: "latest", version: version.latest }
  return undefined
}

// Only a newer release in the installed major version is a normal update.
export function isUpdate(current: string, latest: string) {
  const major = (value: string) => value.replace(/^v/, "").split(".")[0]
  return major(latest) === major(current) && isVersionGreater(latest, current)
}

// Switching always moves to the opposite channel.
export function otherChannel(channel: UpdateChannel): UpdateChannel {
  return channel === "stable" ? "beta" : "stable"
}

// The confirmation shows the target version when one is discoverable on the other channel.
export function switchDescription(info: ChannelInfo) {
  const target = otherChannel(info.channel)
  return info.switchVersion
    ? `Latest ${target} version: ${info.switchVersion}`
    : `Couldn't discover a ${target} version; you can still switch.`
}

export function DialogUpdate(props: {
  check: () => Promise<Version | undefined>
  state: () => UpdateState | undefined
  install: (target: UpdateTarget) => Promise<void>
  skip: (version: string) => void
  restart: () => void
  channel?: () => Promise<ChannelInfo | undefined>
  switchChannel?: (channel: UpdateChannel) => Promise<ChannelInfo | undefined>
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()
  const [active, setActive] = createSignal(0)
  const [confirming, setConfirming] = createSignal<UpdateChannel>()
  const [switching, setSwitching] = createSignal(false)
  const [switchError, setSwitchError] = createSignal<string>()
  const [check, checkActions] = createResource(() =>
    props.check().catch((error: unknown) => {
      setError(errorMessage(error))
      return undefined
    }),
  )
  const [info, infoActions] = createResource(async () => {
    try {
      return await props.channel?.()
    } catch {
      return undefined
    }
  })

  const target = () => {
    const version = check()
    if (!version?.latest) return undefined
    return updateTarget(version)
  }
  const state = createMemo(() => {
    const current = props.state()
    if (current?.type === "installing" || current?.type === "installed") return current
    if (switching()) return { type: "checking" as const }
    if (check.loading) return { type: "checking" as const }
    if (current?.type === "failed") return current
    const next = target()
    if (!next) return { type: "check-failed" as const, message: error() ?? "Couldn't check for updates." }
    return { type: "available" as const, version: next.version }
  })
  const confirmSwitch = async () => {
    const next = confirming()
    const switchChannel = props.switchChannel
    if (!next || !switchChannel) return
    setConfirming(undefined)
    setSwitching(true)
    setSwitchError(undefined)
    try {
      await switchChannel(next)
      await infoActions.refetch()
      await checkActions.refetch()
    } catch (error) {
      setSwitchError(errorMessage(error))
    } finally {
      setSwitching(false)
    }
  }
  const switchButton = () => {
    const current = info()
    if (!props.switchChannel || !current) return undefined
    return {
      label: `Switch to ${otherChannel(current.channel)}`,
      run: () => setConfirming(otherChannel(current.channel)),
    }
  }
  const buttons = createMemo(() => {
    if (switching()) return []
    const confirmed = confirming()
    if (confirmed)
      return [
        { label: "Cancel", run: () => setConfirming(undefined) },
        { label: `Switch to ${confirmed}`, run: () => void confirmSwitch() },
      ]
    const current = state()
    if (current.type === "checking" || current.type === "installing") return []
    const next = target()
    const close = {
      label: "Skip",
      run: () => {
        if (current.type !== "installed" && next) props.skip(next.version)
        dialog.clear()
      },
    }
    const change = switchButton()
    if (current.type === "installed")
      return [...(change ? [change] : []), close, { label: "Restart", run: props.restart }]
    // Keep "Update" as the last (default) button so Enter still installs the update.
    if (!next) return [...(change ? [change] : []), close]
    return [close, ...(change ? [change] : []), { label: "Update", run: () => props.install(next) }]
  })

  createEffect(() => setActive(Math.max(0, buttons().length - 1)))

  const move = (offset: number) => {
    const count = buttons().length
    if (count) setActive((value) => (value + offset + count) % count)
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Confirm update action", group: "Dialog", cmd: () => void buttons()[active()]?.run() },
      { key: "left", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "shift+tab", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "right", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
      { key: "tab", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {state().type === "installing"
            ? "Updating CoderRupee"
            : state().type === "available" || state().type === "failed"
              ? "Update available"
              : "Update"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} gap={1}>
        <Show when={state()} keyed>
          {(current) => (
            <Switch>
              <Match when={current.type === "checking"}>
                <Spinner color={theme.text}>Checking for updates.</Spinner>
              </Match>
              <Match when={current.type === "available"}>
                <text fg={theme.textMuted} wrapMode="word">
                  An update is available. After installing, you'll be prompted to restart CoderRupee.
                </text>
              </Match>
              <Match when={current.type === "installing" && current} keyed>
                {(installing) => (
                  <Spinner color={theme.text}>Installing CoderRupee {installing.target.version}.</Spinner>
                )}
              </Match>
              <Match when={current.type === "installed" && current} keyed>
                {(_installed) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    Update successful! A restart is required.
                  </text>
                )}
              </Match>
              <Match when={(current.type === "failed" || current.type === "check-failed") && current} keyed>
                {(failed) => (
                  <text fg={theme.error} wrapMode="word">
                    {failed.message}
                  </text>
                )}
              </Match>
            </Switch>
          )}
        </Show>
        <Show when={confirming()} keyed>
          {(channel) => (
            <box gap={1}>
              <text fg={theme.text}>Switch to the {channel} channel?</text>
              <Show when={info()} keyed>
                {(value) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {switchDescription(value)}
                  </text>
                )}
              </Show>
            </box>
          )}
        </Show>
        <Show when={switchError()} keyed>
          {(message) => (
            <text fg={theme.error} wrapMode="word">
              {message}
            </text>
          )}
        </Show>
        <Show when={info()} keyed>
          {(value) => (
            <text fg={theme.textMuted} wrapMode="word">
              {channelStatusLine(value)}
            </text>
          )}
        </Show>
      </box>
      <Show when={buttons().length > 0}>
        <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
          <For each={buttons()}>
            {(button, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() === index() ? theme.primary : undefined}
                onMouseUp={() => void button.run()}
              >
                <text fg={active() === index() ? theme.selectedListItemText : theme.textMuted}>{button.label}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

// Status line shown under the update state: current channel plus the last recorded update.
export function channelStatusLine(info: ChannelInfo) {
  const last = info.lastUpdate
  const history = last ? ` · last update ${last.fromVersion} → ${last.toVersion} on ${last.date.slice(0, 10)}` : ""
  return `Channel: ${info.channel}${history}`
}
