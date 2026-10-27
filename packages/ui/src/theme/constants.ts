/**
 * Shared DOM element ids for theme injection. The runtime <style> element and
 * the pre-mount preload <style> element must agree, and the preload removal in
 * applyThemeCss must target the id the preload script actually wrote.
 */
export const THEME_STYLE_ID = "coderrupee-theme"
export const THEME_PRELOAD_STYLE_ID = "coderrupee-theme-preload"
