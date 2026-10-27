import { Switch as Kobalte } from "@kobalte/core/switch"
import { Show, splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import "./switch-v2.css"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Kobalte>> {
  hideLabel?: boolean
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "hideLabel"])
  return (
    <Kobalte {...others} class={local.class} data-component="switch-v2">
      <Kobalte.Input data-slot="switch-v2-input" />
      <Show when={local.children}>
        {(label) => (
          <Kobalte.Label data-slot="switch-v2-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Kobalte.Label>
        )}
      </Show>
      <Kobalte.Control data-slot="switch-v2-control">
        <Kobalte.Thumb data-slot="switch-v2-thumb" />
      </Kobalte.Control>
      <Kobalte.ErrorMessage data-slot="switch-v2-error" />
    </Kobalte>
  )
}
