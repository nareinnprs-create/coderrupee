import { EOL } from "os"
import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { Doctor } from "../../doctor"
import type { DoctorContext } from "../../doctor"
import { DoctorFormat } from "../../doctor/format"
import { cmd } from "./cmd"

/**
 * Runs the doctor checks and renders the report.
 *
 * Human output goes through prompts (stderr) like `coderrupee upgrade`;
 * `--json` writes the machine report to stdout. The process exits 0 unless
 * `--strict` is set and any check warns or fails, in which case the exit code
 * becomes 1.
 */
export async function runDoctor(input: { json?: boolean; strict?: boolean; context?: DoctorContext } = {}) {
  const keyring = input.context ? undefined : await Doctor.defaultKeyring()
  const context = input.context ?? { ...Doctor.defaultContext(), ...(keyring ? { keyring } : {}) }
  const report = await Doctor.runChecks({ context })
  if (input.json) {
    process.stdout.write(DoctorFormat.toJson(report) + EOL)
  } else {
    prompts.intro("Doctor")
    for (const check of report.checks) {
      prompts.log[DoctorFormat.statusToLog(check.status)](DoctorFormat.formatCheckText(check))
      const hint = DoctorFormat.formatHint(check)
      if (hint) prompts.log.message("    " + hint)
    }
    prompts.log.message(DoctorFormat.formatSummary(report))
    prompts.outro("Done")
  }
  if (input.strict && !report.ok) process.exitCode = 1
  return report
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check the health of this coderrupee installation",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        describe: "print the report as JSON",
        type: "boolean",
      })
      .option("strict", {
        describe: "exit with code 1 when any check warns or fails",
        type: "boolean",
      }),
  handler: async (args: { json?: boolean; strict?: boolean }) => {
    await runDoctor({ json: args.json, strict: args.strict })
  },
})
