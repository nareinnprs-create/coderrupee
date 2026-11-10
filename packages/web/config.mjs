const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://coderrupee.opraiz.com" : `https://${stage}.coderrupee.ai`,
  console: stage === "production" ? "https://coderrupee.opraiz.com/auth" : `https://${stage}.coderrupee.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/coderrupee/coderrupee",
  discord: "https://coderrupee.opraiz.com/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
