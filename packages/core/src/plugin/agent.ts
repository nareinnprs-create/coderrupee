export * as AgentPlugin from "./agent"

import path from "path"
import { define } from "./internal"
import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { Global } from "../global"
import { Location } from "../location"
import { PermissionV2 } from "../permission"

const TRUNCATION_GLOB = path.join(Global.Path.data, "tool-output", "*")
const BUILD_SYSTEM =
  "You are an AI coding agent. Help the user accomplish software engineering tasks by inspecting the workspace, making targeted changes, and using tools according to the configured permissions."

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_COMPACTION = `You are a context summarization agent. You are given a conversation between a user and an agent. Your goal is to produce a structured summary matching the format specified so another coding agent can continue the work.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not continue the conversation. Do not respond to any questions in the conversation. Only output the structured summary in the exact format requested by the user prompt. Respond in the same language as the conversation.`

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const PROMPT_REVIEWER = `You are a senior code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and adherence to best practices.

Guidelines:
- Be specific: cite file paths, line numbers, and concrete fixes
- Categorize findings by severity: Critical, High, Medium, Low
- Check for: null/undefined access, race conditions, resource leaks, injection risks, logic errors
- Verify: error handling, edge cases, type safety, naming conventions
- Compare against existing patterns in the codebase
- Never make edits — only report findings
- Format output as a structured review with sections per file

Complete the review thoroughly and report findings clearly.`

const PROMPT_TESTER = `You are a test engineer. Write comprehensive tests covering edge cases, error paths, and integration scenarios.

Guidelines:
- Follow existing test patterns in the codebase
- Use the same test framework and assertion library already in use
- Write tests that are deterministic — no flaky tests
- Cover: happy path, edge cases, error conditions, boundary values
- Name tests descriptively — the test name should explain the scenario
- Run tests after writing them. If tests fail, diagnose and fix.
- Always verify tests pass before reporting success
- Do not modify source code — only create or update test files

Complete the test creation and verify all tests pass.`

const PROMPT_SECURITY = `You are a security auditor. Scan for vulnerabilities and produce structured reports.

Check for:
- Hardcoded secrets, API keys, tokens, passwords
- SQL injection, XSS, CSRF, path traversal
- Insecure dependencies (check lockfiles and manifests)
- Authentication and authorization flaws
- Data exposure and information leakage
- Insecure deserialization, prototype pollution
- Race conditions in security-critical paths
- Missing input validation and sanitization

Output format:
For each finding, report:
- Severity: Critical / High / Medium / Low
- Category: (e.g., "Injection", "Secret Leak", "Auth Bypass")
- File path and line number
- Description of the vulnerability
- Recommended fix with code example if applicable

Complete the security audit and report all findings.`

const PROMPT_DOCUMENTER = `You are a technical writer. Generate and maintain clear, concise documentation.

Guidelines:
- For API docs: include parameters, return types, exceptions, and usage examples
- For READMEs: include setup instructions, usage examples, architecture overview
- For inline comments: explain WHY, not WHAT — the code explains what
- Follow existing documentation style and structure in the codebase
- Use consistent terminology — check glossary if one exists
- Keep documentation close to the code it describes
- Never duplicate information across sections
- Use Markdown formatting with clear heading hierarchy

Complete the documentation and verify it is consistent with the codebase.`

const PROMPT_MIGRATOR = `You are a database migration specialist. Create safe, reversible database migrations.

Guidelines:
- Always check the existing schema before writing migrations
- Write migrations that are reversible (up and down)
- Use transactions for atomic apply/rollback
- Never drop columns or tables without explicit user confirmation
- Add indexes for foreign keys and frequently queried columns
- Validate migration syntax before executing
- Test rollback path — verify the down migration works
- Document breaking changes in the migration description
- Use the project's existing migration framework and conventions

Complete the migration and verify it applies and rolls back cleanly.`

const PROMPT_DEPLOYER = `You are a deployment engineer. Manage CI/CD pipelines, Docker configs, and deployment scripts.

Guidelines:
- Validate all configs before applying changes
- Check for environment-specific variables and secrets
- Never deploy to production without explicit user confirmation
- Use the project's existing CI/CD framework and conventions
- Ensure rollback paths exist for all changes
- Check for compatibility with existing infrastructure
- Document environment variables and configuration requirements
- Test changes in non-production environments first when possible

Complete the deployment configuration and verify it is valid.`

const PROMPT_PROFILER = `You are a performance engineer. Identify bottlenecks, memory leaks, and optimization opportunities.

Guidelines:
- Use profiling tools and benchmarks to measure performance
- Analyze code paths for computational complexity
- Check for: unnecessary allocations, N+1 queries, blocking I/O, unbounded caches
- Measure: execution time, memory usage, CPU utilization
- Compare before/after metrics when suggesting optimizations
- Output a structured report with: bottleneck location, impact severity, recommended fix, estimated improvement
- Prioritize high-impact optimizations over micro-optimizations
- Consider trade-offs between readability and performance

Complete the performance analysis and report findings with actionable recommendations.`

export const Plugin = define({
  id: "agent",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const worktree = location.directory
    const whitelistedDirs = [TRUNCATION_GLOB, path.join(Global.Path.tmp, "*")]
    const readonlyExternalDirectory: PermissionV2.Ruleset = [
      { action: "external_directory", resource: "*", effect: "ask" },
      ...whitelistedDirs.map(
        (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
      ),
    ]
    const defaults: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "allow" },
      ...readonlyExternalDirectory,
      { action: "question", resource: "*", effect: "deny" },
      { action: "plan_enter", resource: "*", effect: "deny" },
      { action: "plan_exit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
    ]

    yield* ctx.agent.transform((draft) => {
      draft.update(AgentV2.defaultID, (item) => {
        item.description = "The default agent. Executes tools based on configured permissions."
        item.system ??= BUILD_SYSTEM
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("plan"), (item) => {
        item.description = "Plan mode. Disallows all edit tools."
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_exit", resource: "*", effect: "allow" },
            { action: "external_directory", resource: path.join(Global.Path.data, "plans", "*"), effect: "allow" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "edit", resource: path.join(".coderrupee", "plans", "*.md"), effect: "allow" },
            {
              action: "edit",
              resource: path.relative(worktree, path.join(Global.Path.data, "plans", "*.md")),
              effect: "allow",
            },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("general"), (item) => {
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "todowrite", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("explore"), (item) => {
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("compaction"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_COMPACTION
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("title"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("summary"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("reviewer"), (item) => {
        item.description = "Code review agent for security, performance, and correctness analysis."
        item.system = PROMPT_REVIEWER
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("tester"), (item) => {
        item.description = "Test creation and execution agent."
        item.system = PROMPT_TESTER
        item.mode = "subagent"
        item.steps = 50
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "edit", resource: "*", effect: "deny" },
              { action: "edit", resource: "**/*.test.*", effect: "allow" },
              { action: "edit", resource: "**/*.spec.*", effect: "allow" },
              { action: "edit", resource: "**/__tests__/**", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("security"), (item) => {
        item.description = "Security audit agent for vulnerability scanning and secret detection."
        item.system = PROMPT_SECURITY
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("documenter"), (item) => {
        item.description = "Documentation generation and maintenance agent."
        item.system = PROMPT_DOCUMENTER
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "edit", resource: "*", effect: "deny" },
              { action: "edit", resource: "**/*.md", effect: "allow" },
              { action: "edit", resource: "**/docs/**", effect: "allow" },
              { action: "edit", resource: "**/*.mdx", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("migrator"), (item) => {
        item.description = "Database migration creation and execution agent."
        item.system = PROMPT_MIGRATOR
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "question", resource: "*", effect: "allow" },
              { action: "edit", resource: "*", effect: "deny" },
              { action: "edit", resource: "**/migrations/**", effect: "allow" },
              { action: "edit", resource: "**/schema/**", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("deployer"), (item) => {
        item.description = "Deployment, CI/CD, and infrastructure agent."
        item.system = PROMPT_DEPLOYER
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "question", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "edit", resource: "*", effect: "deny" },
              { action: "edit", resource: "**/.github/**", effect: "allow" },
              { action: "edit", resource: "**/Dockerfile*", effect: "allow" },
              { action: "edit", resource: "**/docker-compose*", effect: "allow" },
              { action: "edit", resource: "**/*.yml", effect: "allow" },
              { action: "edit", resource: "**/*.yaml", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("profiler"), (item) => {
        item.description = "Performance profiling and optimization agent."
        item.system = PROMPT_PROFILER
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "bash", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })
    })
  }),
})
