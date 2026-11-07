export * as SessionCheckpoint from "./checkpoint"

import { Config } from "@coderrupee/core/config"
import { LayerNode } from "@coderrupee/core/effect/layer-node"
import { Effect, Context, Layer, Option, Schema } from "effect"
import { Session } from "./session"
import { SessionID, MessageID } from "./schema"
import { SessionStatus } from "./status"
import { SessionRevert } from "@coderrupee/core/session/revert"
import { EventV2 } from "@coderrupee/core/event"
import { SessionMessage } from "@coderrupee/core/session/message"

const Marker = Schema.Struct({
  id: Schema.String,
  messageID: MessageID,
  created: Schema.Number,
})
export type Marker = typeof Marker.Type

const Markers = Schema.Array(Marker)
const key = "checkpoints"
const limit = 20

export class DisabledError extends Schema.TaggedErrorClass<DisabledError>()("SessionCheckpoint.DisabledError", {}) {}
export class ConfirmationRequiredError extends Schema.TaggedErrorClass<ConfirmationRequiredError>()(
  "SessionCheckpoint.ConfirmationRequiredError",
  {},
) {}
export class SessionBusyError extends Schema.TaggedErrorClass<SessionBusyError>()(
  "SessionCheckpoint.SessionBusyError",
  {},
) {}
export class MarkerNotFoundError extends Schema.TaggedErrorClass<MarkerNotFoundError>()(
  "SessionCheckpoint.MarkerNotFoundError",
  { markerID: Schema.String },
) {}

export const encode = (markers: readonly Marker[]) => new TextEncoder().encode(JSON.stringify(markers))
export const decode = (bytes: Uint8Array): Marker[] => {
  const value = Schema.decodeUnknownOption(Markers)(JSON.parse(new TextDecoder().decode(bytes)))
  return Option.isSome(value) ? Array.from(value.value) : []
}

export interface Interface {
  readonly list: (sessionID: SessionID) => Effect.Effect<Marker[], DisabledError | Session.NotFound>
  readonly create: (input: {
    sessionID: SessionID
    messageID: MessageID
  }) => Effect.Effect<Marker, DisabledError | Session.NotFound>
  readonly restore: (input: {
    sessionID: SessionID
    markerID: string
    confirmed: boolean
  }) => Effect.Effect<
    void,
    DisabledError | ConfirmationRequiredError | SessionBusyError | MarkerNotFoundError | Session.NotFound
  >
}

export class Service extends Context.Service<Service, Interface>()("@coderrupee/SessionCheckpoint") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2.Service

    const enabled = Effect.fnUntraced(function* () {
      const session = Config.latest(yield* config.entries(), "session")
      if (session?.checkpoints !== true) return yield* new DisabledError()
    })
    const read = Effect.fnUntraced(function* (sessionID: SessionID) {
      const metadata = (yield* sessions.get(sessionID)).metadata
      if (!metadata) return []
      const value = Schema.decodeUnknownOption(Markers)(metadata[key])
      return Option.isSome(value) ? [...value.value] : []
    })
    const write = Effect.fnUntraced(function* (sessionID: SessionID, markers: readonly Marker[]) {
      const session = yield* sessions.get(sessionID)
      const metadata = { ...(session.metadata ?? {}) } as Record<string, unknown>
      metadata[key] = markers
      yield* sessions.setMetadata({ sessionID, metadata })
    })
    const list = Effect.fn("SessionCheckpoint.list")(function* (sessionID) {
      yield* enabled()
      return yield* read(sessionID)
    })
    const create = Effect.fn("SessionCheckpoint.create")(function* (input) {
      yield* enabled()
      yield* sessions.get(input.sessionID)
      const markers = yield* read(input.sessionID)
      const marker = {
        id: `cp_${crypto.randomUUID()}`,
        messageID: input.messageID,
        created: Date.now(),
      } satisfies Marker
      yield* write(input.sessionID, [...markers, marker].slice(-limit))
      return marker
    })
    const restore = Effect.fn("SessionCheckpoint.restore")(function* (input) {
      yield* enabled()
      if (!input.confirmed) return yield* new ConfirmationRequiredError()
      if ((yield* status.get(input.sessionID)).type !== "idle") return yield* new SessionBusyError()
      const markers = yield* read(input.sessionID)
      const marker = markers.find((item) => item.id === input.markerID)
      if (!marker) return yield* new MarkerNotFoundError({ markerID: input.markerID })
      const messages = yield* sessions.messages({ sessionID: input.sessionID })
      const boundary = messages.findIndex((item) => item.info.id === marker.messageID)
      if (boundary < 0) return yield* new MarkerNotFoundError({ markerID: input.markerID })
      yield* Effect.forEach(
        messages.slice(boundary + 1),
        (item) => sessions.removeMessage({ sessionID: input.sessionID, messageID: item.info.id }),
        {
          discard: true,
        },
      )
      yield* SessionRevert.truncate({
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.make(marker.messageID),
      }).pipe(Effect.provideService(EventV2.Service, events))
      yield* write(
        input.sessionID,
        markers.filter((item) => messages.findIndex((message) => message.info.id === item.messageID) <= boundary),
      )
    })
    return Service.of({ list, create, restore })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Session.node, SessionStatus.node, EventV2.node],
})
