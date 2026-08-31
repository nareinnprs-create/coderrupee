import { addons, types } from "storybook/manager-api"
import { ThemeTool } from "./theme-tool"

addons.register("coderrupee/theme-toggle", () => {
  addons.add("coderrupee/theme-toggle/tool", {
    type: types.TOOL,
    title: "Theme",
    match: ({ viewMode }) => viewMode === "story" || viewMode === "docs",
    render: ThemeTool,
  })
})
