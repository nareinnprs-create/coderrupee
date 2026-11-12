# CoderRupee — Product Roadmap

> Personal-use build. Not a commercial platform.
> Owner: Narein Rao · R&D: opraizfoundry

CoderRupee is a **personal autonomous computing agent**: it builds software, controls the
local device and applications, automates assigned work, performs cybersecurity tasks, runs
agentic multi-step workflows, and tests/debugs — to the maximum.

This document is the agreed plan. It is grounded in a read-only feasibility pass over the
existing codebase (a rebranded fork of `opencode`). **No implementation has started.**

---

## 1. Decision log

| # | Decision | Choice |
|---|---|---|
| 1 | Purpose | Personal use only — not commercial |
| 2 | Platforms | Windows + macOS + Linux |
| 3 | Scope of abilities | All six domains: build · device · app · automation · security · agentic |
| 4 | Where built | Shared engine first (portable across TUI/desktop/CLI) |
| 5 | Autonomy | Tiered `T0`–`T3` |
| 6 | Build order | Safety foundation first |
| 7 | Runtime | Local agent daemon (on-demand) |
| 8 | Action scope | Own assets + authorized third-party |
| 9 | Grounding | Extend existing server / permission / event systems — do not rebuild |
| 10 | Build target | V1 live runtime now, V2-compatible seams |
| 11 | Platform strategy | All three OSes in parallel |
| 12 | First superpower | Device & OS control (P2) |
| 13 | Resident mode | On-demand by default; opt-in resident per schedule/trigger |

### Autonomy tiers

| Tier | Class | Examples | Default |
|---|---|---|---|
| **T0 Observe** | read-only | file read, screen capture, process list, netstat, scans | auto-allow (scoped) |
| **T1 Local act** | reversible, in-scope | edit project files, build/test, temp files, local git | auto-allow in project |
| **T2 Outward/system** | side effects | install packages, OS settings, network calls, send/schedule, GUI input | confirm |
| **T3 Destructive/elevated** | irreversible/high-risk | delete outside project, admin/elevate, credential access, mass automation, exploit actions | typed confirm |

Tiers are a **floor** applied after normal rule resolution, keyed on the tool's action
string. They are enforced **regardless of saved "always" rules**.

---

## 2. Feasibility findings (grounding)

The platform is better prepared than expected. Key facts:

| Need | What exists | Consequence |
|---|---|---|
| Permission gate | Single chokepoint `PermissionV2.evaluate/evaluateInput` (`packages/core/src/permission.ts:76-162`); V1 mirror `packages/coderrupee/src/permission/index.ts:28-107` | Tiers = post-process floor keyed on action string; no per-tool rewrites |
| Policy interception | `permission.ask` hook declared but **never wired** (`packages/plugin/src/index.ts:261`) | Free, ultra-low-risk seam for policy/audit injection |
| Local daemon | **Already exists**: `packages/cli/src/services/daemon.ts` + `service start/status/stop/password`; state in `XDG_STATE/coderrupee` (`server.json`, `password` 0600); Basic-auth loopback | "On-demand agent daemon" = extend this, not build new |
| Audit bus | `EventV2` is durable SQLite with replay + projectors (`packages/core/src/event.ts`, `event/sql.ts`) | Audit log = projector into new `audit_log` table; atomic + replay-safe |
| New tools | V2 stack: `Tool.make` + `Tools.Service.register` + `Tool.withPermission` (`core/src/tool/tool.ts`) | One leaf file per tool; scoped, removable |
| Orchestration | `task` tool spawns child sessions (`coderrupee/src/tool/task.ts`); per-turn parallelism; background jobs; `steps` caps | Workflows = commands + existing task plumbing |

Corrections to earlier assumptions: the server is **Effect HTTP, not Hono**; the TUI runs
the server **in-process** (worker), not connecting out.

Migration note: the repo is **mid-migration V1 → V2**. V1 (`packages/coderrupee`) is the
**live runtime**; V2 (`packages/core`) is canonical but incomplete. We build on **V1** and
keep seams V2-compatible.

---

## 3. Capability catalog + tiers

| Tool | Domain | Tier | Status |
|---|---|---|---|
| `read` `glob` `grep` `list` `websearch` `webfetch`(read) | Observe | T0 | exists |
| `edit` `write` `apply_patch` `bash`(project) `todowrite` `task` | Local act | T1 | exists |
| `bash`(system) `net` `screen` `input` `window` `os` `browser` | Outward/system | T2 | new |
| `delete-outside` `elevate` `credentials` `sec-exploit` `mass-auto` | Destructive/elevated | T3 | new |

New tool families (each a leaf + permission action + tier entry): `screen` (capture/OCR),
`input` (mouse/keyboard), `window` (list/focus/arrange), `os` (services/registry/defaults),
`browser` (Playwright), `net` (ports/HTTP/tunnel), `sec` (recon/scan/harden).

---

## 4. Cross-OS abstraction seam

One `PlatformCapability` interface in the shared engine; each OS supplies a backend; tools
call the interface, never the OS directly.

```
Tool (screen/input/window/os)  ──►  PlatformCapability interface
                                        ├── Win   (Win32 / UI Automation, PowerShell)
                                        ├── macOS (Accessibility, AppleScript)
                                        └── Linux (X11; Wayland best-effort, xdotool/AT-SPI)
```

- Shell automation is already cross-platform: the fork parses **bash and PowerShell**.
- GUI automation is the new dependency risk; one wrapped library per concern behind the
  interface so implementations can be swapped without touching agents.
- Interface lives in the engine so TUI, desktop, and daemon share it.

**P2 ships the interface + `screen`/`input`/`window`/`os` tools once per OS, all three in
parallel.** Wayland is best-effort.

---

## 5. Agents & orchestration

Existing specialists: `reviewer`, `tester`, `security`, `documenter`, `migrator`,
`deployer`, `profiler` (`packages/coderrupee/src/agent/agent.ts:272`).

Proposed additions: `architect`, `refactorer`, `debugger`, `researcher`, `release-manager`,
`data-analyst`, `ui-designer`, `localizer`.

Orchestration commands (compose subagents via the existing `task` tool):

| Command | Chain |
|---|---|
| `/feature` | architect → build → reviewer → tester → documenter |
| `/harden` | security → reviewer → tester(edge) |
| `/ship` | release-manager → deployer |
| `/investigate` | debugger → profiler → reviewer |
| `/autopilot` | planner + long-horizon loop with checkpoints |

Supervision: parent/child sessions already isolate scope; add a wrapper enforcing tier
checks, `steps` budgets, background-job tracking, and interruptibility for every child.

---

## 6. Automation model

- **Hooks (safe, V1):** `tool.execute.before/after`, `chat.*`, `event`, plus the unwired
  `permission.ask` → policy + audit.
- **Triggers:** file-watch (chokidar / parcel-watcher already present), git events,
  webhooks, OS events.
- **Schedules:** resident loop (`Effect.repeat` / `forkScoped`).
- **Resident mode:** on-demand by default; auto-enable only when a schedule/trigger exists,
  with stronger auth, a visible "resident" indicator, and kill switch. Idle-exits when no
  scheduled work remains.

---

## 7. Security toolset + authorization gate

Domains: recon → scan → harden → monitor, wrapped by the **target registry**:

- Authorized targets = this machine, my accounts, named third-party assets (scope + expiry).
- **Default-deny** for anything unregistered.
- Every T2/T3 action against a third-party target requires an explicit grant; the audit log
  ties each outward action to its grant.
- Own-assets actions use normal tiers. This keeps the cyber domain authorized-only.

---

## 8. Observability & UX

- **Audit viewer** from the `audit_log` projection; **replay** via `EventV2.durable({after})`.
- **Live view**: subscribe to `/event` / `/api/event` SSE.
- **Kill switch / pause / dry-run** wired to the runner interrupt.
- **Surfaces**: TUI panels (agents, activity, approvals) now; desktop **control center**
  (timeline, approvals, per-target grants) later.

---

## 9. Roadmap

| Phase | Goal | Exit criteria |
|---|---|---|
| **P0** | Safe baseline | `.gitattributes` kills CRLF noise; green typecheck/tests; TUI smoke on Windows |
| **P1** | Safety foundation | Tier engine live at the permission chokepoint; target registry; `audit_log` projector; kill switch/dry-run; `permission.ask` wired |
| **P2** | Device/OS control | `PlatformCapability` + `screen`/`input`/`window`/`os` tools on all three OSes |
| **P3** | App control | `browser` (Playwright) + desktop-app driving |
| **P4** | Automation | triggers/schedules/hooks + opt-in resident mode |
| **P5** | Orchestration | workflow commands + supervision |
| **P6** | Cybersecurity | recon/scan/harden/monitor behind the authorization gate |
| **P7** | Quality depth | debug/profiling/fuzzing |

Phase 1 is the hinge: everything after it is a loaded weapon without it.

### P0 — Safe baseline (first, small, reversible)

1. Add `.gitattributes` (`* text=auto eol=lf`, explicit binary globs) → ends the ~4,970-file
   CRLF noise.
2. Re-normalize once (`git add --renormalize .`), commit as a **separate, isolated commit**.
3. Verify green: `bun install`, per-package `bun typecheck`, `bun test` in
   `packages/coderrupee`, TUI smoke (`bun dev`), desktop package.
4. Add a desktop job to `typecheck.yml` / `test.yml` (desktop is currently untested).

### P1 — Safety Foundation (feature-flagged; default behavior unchanged)

| Step | What | Seam |
|---|---|---|
| 1 | Tier model: `Tier = T0…T3` + static `action→tier` map + `applyTierFloor(effect, action)` | new `packages/coderrupee/src/permission/tier.ts` |
| 2 | Wire tier floor into V1 `evaluate`/`ask`; enforce regardless of saved rules; T3 typed confirm | `coderrupee/src/permission/index.ts:28-107` |
| 3 | Forward-port same floor into V2 (guarded) | `core/src/permission.ts:76-162` |
| 4 | Target registry: authorized targets (self/accounts/3rd-party w/ scope+expiry), default-deny | new `coderrupee/src/permission/targets.ts` |
| 5 | Audit log table (id, session, ts, tool, tier, args-redacted, decision, result, target, grant, platform, ms) | new `core/src/audit/audit.sql.ts` + regenerate migration |
| 6 | Emit audit on every tool call | V1 `session/tools.ts:106,121` hook path |
| 7 | Kill switch / pause / dry-run + global mode consulted by tier layer; wire to session interrupt | extend `cli/src/services/daemon.ts` + server routes |
| 8 | Wire `permission.ask` (dead) for policy/plugin interception | `plugin/src/index.ts:261` → trigger in `coderrupee/src/permission/index.ts` |

---

## 10. Working agreement

- Short branch off `dev` (≤3 words, hyphenated, no `feat/` prefixes).
- One milestone per branch.
- **Feature-flag the safety layer**; default (off) behavior must be byte-identical.
- Per-package verification: `bun typecheck`, `bun test` from package dirs (never repo root).
- Diffs shown before any commit; `dev` stays green throughout.
- Never edit generated files (`packages/client/src/generated*`); regenerate via scripts.
- No commits unless explicitly requested.
