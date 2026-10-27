import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/coderrupee-theme-preload.js", import.meta.url))

const channel = (() => {
  const raw = process.env.CODERRUPEE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.CODERRUPEE_CHANNEL === "latest") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "coderrupee-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_CODERRUPEE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "coderrupee-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="coderrupee-theme-preload-script" src="/coderrupee-theme-preload.js"></script>',
        `<script id="coderrupee-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
