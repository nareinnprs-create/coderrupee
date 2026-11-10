// Read by the AI SDK's log-warnings module to gate its stdout warning output; assigned
// at server startup to keep warning noise off the transport-facing process stdout.
declare var AI_SDK_LOG_WARNINGS: boolean | undefined
