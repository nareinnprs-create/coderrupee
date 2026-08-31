export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@coderrupee/schema/event"
import { EventManifest } from "@coderrupee/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
