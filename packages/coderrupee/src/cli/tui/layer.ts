import { run as runTui, type TuiInput } from "@coderrupee/tui"
import { Global } from "@coderrupee/core/global"
import { AppNodeBuilder } from "@coderrupee/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
