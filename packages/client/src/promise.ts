export * from "./generated/index"
export type { EventsSubscribeOutput as CoderRupeeEvent } from "./generated/types"

export type CoderRupeeClient = ReturnType<typeof import("./generated/client").make>

export type FileDiffInfo = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}
