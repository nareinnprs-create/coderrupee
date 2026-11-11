# Deferred upstream integration — revisit list

Upstream reference: anomalyco/opencode `origin/dev` (v2.2.7), fork point `9f69463f1d`.
Triage date: 2026-11-11. These items were reviewed and **deliberately skipped** during the
v1.2.0 integration wave. Revisit when the listed blocker changes.

## Requires upstream-hosted infrastructure (cannot run without their services)
- **OpenTunnel remote device pairing** — Settings → Pairing QR flow. Needs upstream tunnel endpoints. Refs: `2caba90a63` (#50972), `0d07f915d2` (#53837), `55306` (#55306).
- **Console-hosted voice calls** (GPT-Live/Realtime/Grok Voice, Gemini Live) — depends on opencode.ai console + provider keys. Refs: `28ea040f05` (#58249), `d9a0805c25` (#58587), `57735`, `56888`.
- **R2-hosted desktop auto-update feed** — upstream's `app-update.yml` points at their R2 worker. Ours uses GitHub releases. Refs: #59529, `567f8b9743`, #60696.
- **Stats / usage poster backend**, Discord announce, Stripe/AWS billing — upstream `services/*` + sst infra. Refs: `73c95abac2`, #60371.

## Requires upstream identities/accounts we do not hold
- Apple Developer ID + passwordless notarization; Azure Trusted Signing (upstream Windows signing). Refs: #59768/#59760, #48566/#48567.
- `@opencode` npm org, `sst-dev` VS Code publisher, homebrew-tap deploy key, AUR/WinGet accounts.
- GitHub Action upstream removed in v2.2.0 (#59032) — our GitHub Action equivalent already diverged.

## Product features that are upstream-brand or upstream-billing
- Zen/Go free-limit + usage-limit monetization UX. Refs: `4cba1b7f5d`, `de284dc1bc`, `e42f6d1016`, `a9fa57b738`, `d9ecbbc874`, `3eb834b85a`, #57466–57471, #60284.
- Zen/Go marketing pages in `packages/web` (model promos, pricing).

## Architecture conflicts (re-evaluate on next major merge)
- **GUI plugin system** (themes, CodeBlock registries, native settings, panel width) — 1,179 files/+14.7k lines, needs gui-extensions architecture. Refs: `dae4077a96` (#55246), `758cf5adbe` (#59469), `5792c3e63b` (#59489), #61485/#61533/#61527/#61509.
- **TUI "new designs" dialog overhaul** — conflicts with our brand kit + v2 dimension tokens. Refs: `09ef07e11e` (#55818), #55501–55523, #56095–56100.
- **V2 theme system internals + migrated V1 theme layouts** — superseded by CoderRupee brand themes. Refs: `9a25673c37`, `8f3465c951`, `168aba6183`, `b7992598be`.
- **MCP client SDK-v2 rework** (pool connections, socket transports) — rewrite, not a port; our MCP is separate on SDK v1. Take the fix list instead (tracked in Tier 1 S5). Refs: `cbe8823671`, `33d52e6011`, `0030a705a3`, `4a6dacec5e`, #61185.
- **`session_part` table + part-rows write-amplification perf** — conflicts with our V2 store/projector. Refs: `c1b5f1b416`, `6000b7c51b`.
- **Tool namespace restructure (`tool/plugin/*`)** — ours is flat; cherry-pick fixes only. Refs: `6a99898ef7`, `32f89748af`, `40cbea3c19`.
- **Effect version bumps** (4.0.6/4.1.0) — we pin our own Effect v4 line; take the SQLite interrupt lock-up fix only (tracked Tier 1 S8). Refs: `66f8…`, `c6056f3931`, `1aae67e853`.
- **Claude Agent provider + Console plugin suite** — wired to opencode.ai Console accounts/managed policy. Revisit if zen gains a hosted console. Refs: `f29e281322`, `fa928beb84`, `a98e3fa7a1`, `288fa12843`, `993a280887`, #58782.
- **Voice `client.voice.*` experimental API** — see Console-hosted voice above. Refs: #55951, #57194.
- **Docs-site SolidStart V2 restructure** — our docs pipeline diverged (Starlight at /docs on Cloudflare Pages). Refs: #62229, #62951, #62389, #54906, #62182.
- **`packages/sdk-next`** — dead upstream (superseded by `@opencode/ai`); ours already removed.
- **Upstream package deletions** (`console`, `enterprise`, `docs`, `llm`, `slack`, `storybook`, `containers`) — do not sync as deletions; ours serve CoderRupee purposes.
- **Wire-contract v2.1 `native` rename + `@opencode/ai` Promise-root restructure** — only relevant if we ever adopt upstream SDK/protocol wholesale; requires simultaneous core+SDK+VS Code crossing. Refs: #57260, #58847, `dad29a8991`, #62796, #63040.
- **"Go" allowance/usage-limit product surfaces** — see upstream-brand above.
- **One-time share links** — needs their share worker. Refs: `2caba90a63`, `0d07f915d2`.
- **models.dev catalog pinned/verified at release + Console runtime config** — strip/stub; we already fetch models.dev directly. Refs: #59173, #62404.

## Already covered by our own work (do not re-port)
FileMutation pipeline (formatter/LSP/events/transactions/crash-replay), fuzzy edit matcher,
parser-based bash approvals + BashArity, background jobs + get/wait/cancel, projector
version binding, executeStream, reasoning-token cost (raw output billing), doctor, OS keyring,
update channels/rollback, cost budgets, guarded checkpoints, 7 subagents, zen provider,
azure/nvidia/zenmux/kilo/vercel/openrouter/llmgateway plugins, Copilot billing bridge,
compaction replay-leak (export-side check landed with Tier 1), edit mixed-line-ending
preservation, todowrite, desktop tray/notifications/deep-links/updater.
