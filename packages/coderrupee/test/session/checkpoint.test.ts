import { expect, test } from "bun:test"
import { SessionCheckpoint } from "../../src/session/checkpoint"
import { MessageID } from "../../src/session/schema"

test("checkpoint markers round-trip byte-for-byte", () => {
  const markers = [{ id: "cp_1", messageID: MessageID.make("msg_1"), created: 1 }]
  expect(SessionCheckpoint.encode(SessionCheckpoint.decode(SessionCheckpoint.encode(markers)))).toEqual(
    SessionCheckpoint.encode(markers),
  )
})
