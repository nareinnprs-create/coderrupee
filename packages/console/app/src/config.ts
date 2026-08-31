/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://coderrupee.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/coderrupee/coderrupee",
    starsFormatted: {
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/coderrupee",
    discord: "https://discord.gg/coderrupee",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
