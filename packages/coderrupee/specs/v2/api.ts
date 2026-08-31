// @ts-nocheck

import { CoderRupee } from "@coderrupee/core"
import { ReadTool } from "@coderrupee/core/tools"

const coderrupee = CoderRupee.make({})

coderrupee.tool.add(ReadTool)

coderrupee.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

coderrupee.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

coderrupee.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await coderrupee.session.create({
  agent: "build",
})

coderrupee.subscribe((event) => {
  console.log(event)
})

await coderrupee.session.prompt({
  sessionID,
  text: "hey what is up",
})

await coderrupee.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await coderrupee.session.wait()

console.log(await coderrupee.session.messages(sessionID))
