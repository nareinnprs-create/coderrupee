const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://coderrupee.ai" : `https://${stage}.coderrupee.ai`,
  console: stage === "production" ? "https://coderrupee.ai/auth" : `https://${stage}.coderrupee.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/coderrupee/coderrupee",
  discord: "https://coderrupee.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
