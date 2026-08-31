import { registerCustomTheme } from "@pierre/diffs"
import { CoderRupeeTheme } from "./marked-theme"

let registered = false

export function registerCoderRupeeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("CoderRupee", () => Promise.resolve(CoderRupeeTheme))
}
