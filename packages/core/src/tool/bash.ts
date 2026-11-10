export * as BashTool from "./bash"

import path from "path"
import { ToolFailure } from "@coderrupee/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { BackgroundJob } from "../background-job"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess, collectStream } from "../process"
import { PermissionV2 } from "../permission"
import { Shell } from "../shell"
import { ShellParse } from "../shell/parse"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}. Background commands have no timeout.`,
    }),
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need '&' at the end of the command. Observe it with the background_get, background_wait, and background_cancel tools.",
  }),
})

const BackgroundStatus = Schema.Literals(["running", "completed", "error", "cancelled"])

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
  jobID: Schema.String.pipe(Schema.optional),
  status: BackgroundStatus.pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const JobOutput = Schema.Struct({
  id: Schema.String,
  status: BackgroundStatus,
  output: Schema.String,
  timedOut: Schema.Boolean.pipe(Schema.optional),
})

type JobOutput = typeof JobOutput.Type

const BACKGROUND_INSTRUCTION =
  "You will not be notified automatically; check this job with background_get or background_wait. Do not poll in a tight loop; keep working on other tasks and check again when you need the result."

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.status === "running") return `${warnings.trimStart()}${warnings ? "\n\n" : ""}${BACKGROUND_INSTRUCTION}`
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

/**
 * Shell command approval uses the portable shell scanner: each parsed command is
 * requested individually and saved grants are command-prefix patterns, so one
 * approved prefix covers matching commands in later scripts. Scripts the parser
 * cannot analyze fail closed instead of running under a whole-script grant.
 */
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Background jobs are process-local; persist durable job status and define restart recovery (adopt or kill orphans) before any remote observation.
// TODO: Deliver background completion to the owning Session automatically once a synthetic-message channel exists; background_wait is the interim delivery path.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const externalDirectories = Effect.fn("BashTool.externalDirectories")(function* (
  fs: FSUtil.Interface,
  directories: ReadonlyArray<string>,
  cwd: string,
) {
  const resolved: string[] = []
  for (const directory of new Set(directories)) {
    const canonical = yield* fs.resolve(directory)
    if (FSUtil.contains(cwd, canonical)) continue
    resolved.push(canonical)
  }
  return [...new Set(resolved)]
})

// PowerShell wrappers need explicit invocation arguments; other shells take the command through the shell option.
const shellCommand = (shell: string, command: string, cwd: string) =>
  Shell.ps(shell)
    ? ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
        cwd,
        stdin: "ignore",
        forceKillAfter: Duration.seconds(3),
      })
    : ChildProcess.make(command, [], {
        cwd,
        shell,
        stdin: "ignore",
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      })

const jobOutput = (info: BackgroundJob.Info, timedOut?: boolean): JobOutput => ({
  id: info.id,
  status: info.status,
  output: info.output ?? info.error ?? "",
  ...(timedOut === undefined ? {} : { timedOut }),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const jobs = yield* BackgroundJob.Service

    const resolveShell = Effect.fn("BashTool.resolveShell")(function* () {
      const entries = yield* config.entries()
      const configured = Object.assign(
        {},
        ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])),
      ).shell
      return Shell.acceptable(configured)
    })

    const ownedJob = Effect.fn("BashTool.ownedJob")(function* (jobID: string, context: Tool.Context) {
      const info = yield* jobs.get(jobID)
      // Owner-bound observation: a Session may only see the jobs it launched.
      if (!info || info.metadata?.sessionID !== context.sessionID)
        return yield* new ToolFailure({ message: `Background job not found: ${jobID}` })
      return info
    })

    const backgroundRun = (command: ChildProcess.Command) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* appProcess.spawn(command)
          const [captured, exit] = yield* Effect.all([collectStream(handle.all, MAX_CAPTURE_BYTES), handle.exitCode], {
            concurrency: "unbounded",
          })
          const text = captured.buffer.toString("utf8") || "(no output)"
          const notice = captured.truncated ? "\n\n[output capture truncated at the in-memory safety limit]" : ""
          return `${text}${notice}\n\nCommand exited with code ${exit}.`
        }),
      )

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; cd targets outside the Location are advisory warnings only. Each parsed command in the script is approved individually, and approving a command prefix reuses that grant for matching commands in later scripts; scripts the scanner cannot analyze are rejected. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}); background commands have no timeout. Uses the configured shell when set; otherwise resolves the platform default shell (PowerShell when available on Windows, otherwise COMSPEC or cmd.exe).`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({
            truncated: output.truncated,
            ...(output.exit === undefined ? {} : { exit: output.exit }),
            ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
            ...(output.jobID === undefined ? {} : { jobID: output.jobID }),
            ...(output.status === undefined ? {} : { status: output.status }),
          }),
          toModelOutput: ({ output }) => [
            { type: "text", text: output.output },
            { type: "text", text: modelOutput(output) },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const shell = yield* resolveShell()
              const parsed = yield* ShellParse.scan(input.command, shell, target.canonical).pipe(
                Effect.mapError((error) => new ToolFailure({ message: error.message })),
              )
              const warnings = (yield* externalDirectories(fs, parsed.directories, target.canonical)).map(
                (directory) =>
                  `Command changes into external directory ${directory.replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
              )
              if (parsed.commands.length > 0)
                yield* permission.assert({
                  action: name,
                  resources: parsed.commands.map((command) => command.resource),
                  save: parsed.commands.map((command) => command.save),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* new ToolFailure({ message: `Working directory is not a directory: ${target.canonical}` })

              const command = shellCommand(shell, input.command, target.canonical)

              if (input.background === true) {
                const job = yield* jobs.start({
                  type: name,
                  title: input.command,
                  metadata: { sessionID: context.sessionID },
                  run: backgroundRun(command),
                })
                return {
                  output: `Command moved to the background (job ID: ${job.id}).\nGet its output with background_get, wait for it with background_wait, or stop it with background_cancel.`,
                  truncated: false,
                  jobID: job.id,
                  status: "running" as const,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const result = yield* appProcess
                .run(command, {
                  combineOutput: true,
                  timeout: Duration.millis(timeout),
                  maxOutputBytes: MAX_CAPTURE_BYTES,
                })
                .pipe(
                  Effect.catchTag("AppProcessError", (error) =>
                    isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                  ),
                )
              if (!result) {
                return {
                  output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  truncated: false,
                  timeout: true,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const output = result.output?.toString("utf8") || "(no output)"
              const notice = result.outputTruncated
                ? "[output capture truncated at the in-memory safety limit]"
                : undefined
              return {
                exit: result.exitCode,
                output: notice ? `${output}\n\n${notice}` : output,
                truncated: result.outputTruncated === true,
                ...(warnings.length ? { warnings } : {}),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to execute command: ${input.command}` }),
              ),
            ),
        }),
        background_get: Tool.make({
          description:
            "Get the current status and captured output of a background command started with the bash tool in this session.",
          input: Schema.Struct({
            jobID: Schema.String.annotate({ description: "The job ID returned by the background bash launch." }),
          }),
          output: JobOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.status === "running"
                  ? `Background job ${output.id} is still running.`
                  : `Background job ${output.id} ${output.status}.\n${output.output}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const info = yield* ownedJob(input.jobID, context)
              return jobOutput(info)
            }),
        }),
        background_wait: Tool.make({
          description:
            "Wait for a background command started with the bash tool in this session to finish, and return its output. Omit timeout to wait indefinitely.",
          input: Schema.Struct({
            jobID: Schema.String.annotate({ description: "The job ID returned by the background bash launch." }),
            timeout: PositiveInt.pipe(Schema.optional).annotate({
              description: "Maximum milliseconds to wait before returning the current status.",
            }),
          }),
          output: JobOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.status === "running"
                  ? `Background job ${output.id} is still running${output.timedOut ? " (wait timed out)" : ""}.`
                  : `Background job ${output.id} ${output.status}.\n${output.output}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const owned = yield* ownedJob(input.jobID, context)
              const result = yield* jobs.wait({
                id: owned.id,
                ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
              })
              return jobOutput(result.info ?? owned, result.timedOut)
            }),
        }),
        background_cancel: Tool.make({
          description: "Stop a background command started with the bash tool in this session.",
          input: Schema.Struct({
            jobID: Schema.String.annotate({ description: "The job ID returned by the background bash launch." }),
          }),
          output: JobOutput,
          toModelOutput: ({ output }) => [
            { type: "text", text: `Background job ${output.id} ${output.status}.` },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const owned = yield* ownedJob(input.jobID, context)
              const info = yield* jobs.cancel(owned.id)
              return jobOutput(info ?? owned)
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [
    ToolRegistry.node,
    LocationMutation.node,
    FSUtil.node,
    AppProcess.node,
    Config.node,
    PermissionV2.node,
    BackgroundJob.node,
  ],
})
