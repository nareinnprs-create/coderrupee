export * as DoctorFormat from "./format"

import type { CheckResult, DoctorReport, Status } from "."

export type LogLevel = "success" | "warn" | "error" | "info"

const logForStatus: Record<Status, LogLevel> = {
  pass: "success",
  warn: "warn",
  fail: "error",
  info: "info",
}

export function statusToLog(status: Status): LogLevel {
  return logForStatus[status]
}

export function formatCheckText(check: CheckResult): string {
  return check.detail ? `${check.label}: ${check.detail}` : check.label
}

export function formatHint(check: CheckResult): string | undefined {
  return check.hint ? `hint: ${check.hint}` : undefined
}

export function formatSummary(report: DoctorReport): string {
  const parts = [`${report.checks.length} checks`, `${report.counts.pass} pass`]
  if (report.counts.warn > 0) parts.push(`${report.counts.warn} warn`)
  if (report.counts.fail > 0) parts.push(`${report.counts.fail} fail`)
  if (report.counts.info > 0) parts.push(`${report.counts.info} info`)
  return parts.join(", ")
}

export function toJson(report: DoctorReport): string {
  return JSON.stringify(
    {
      ok: report.ok,
      counts: report.counts,
      checks: report.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        detail: check.detail,
        hint: check.hint,
      })),
    },
    null,
    2,
  )
}
