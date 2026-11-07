export * as ConfigSession from "./session"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigSession.Info")({
  checkpoints: Schema.Boolean.pipe(Schema.optional),
}) {}
