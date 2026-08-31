import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { createMarkdownParser } from "./marked-parser"
import { registerCoderRupeeTheme } from "./marked-theme-register"

export { CoderRupeeTheme } from "./marked-theme"

registerCoderRupeeTheme()

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: () =>
    createMarkdownParser(async (code, language) => {
      const highlighter = await getSharedHighlighter({
        themes: ["CoderRupee"],
        langs: [],
        preferredHighlighter: "shiki-wasm",
      })
      const name = language in bundledLanguages ? language : "text"
      if (!highlighter.getLoadedLanguages().includes(name)) await highlighter.loadLanguage(name as BundledLanguage)
      return highlighter.codeToHtml(code, {
        lang: name,
        theme: "CoderRupee",
        tabindex: false,
      })
    }),
})
