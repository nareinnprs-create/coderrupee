import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerCoderrupeeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
