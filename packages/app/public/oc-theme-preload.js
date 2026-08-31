;(function () {
  var key = "coderrupee-theme-id"
  var themeId = localStorage.getItem(key) || "coderrupee"

  if (themeId === "oc-1" || themeId === "oc-2") {
    themeId = "coderrupee"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("coderrupee-theme-css-light")
    localStorage.removeItem("coderrupee-theme-css-dark")
  }

  var scheme = localStorage.getItem("coderrupee-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  if (themeId === "coderrupee") return

  var css = localStorage.getItem("coderrupee-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
