# pi-superpowers-plus

Structured workflow skills, coding discipline, and active enforcement extensions for [pi](https://github.com/badlogic/pi-mono).

Your coding agent doesn't just know the rules — it follows them. Skills teach the agent *what* to do (brainstorm before building, write tests before code, keep code simple, verify before claiming done). Extensions enforce it in real time (the workflow monitor watches every file write and warns when you skip the test).

Based on [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent, ported to pi as [pi-superpowers](https://github.com/coctostan/pi-superpowers) by coctostan, then forked with active enforcement extensions, [pi-subagents](https://github.com/nicobailon/pi-subagents) integration, and a `coding-discipline` skill inspired by [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

## What You Get When You Install This

**13 workflow skills** that guide the agent through a structured development process — from brainstorming ideas through shipping code:

| # | Skill | Purpose |
|---|-------|---------|
| 1 | `brainstorming` | Refines ideas into design documents via Socratic dialogue |
| 2 | `writing-plans` | Breaks designs into bite-sized TDD tasks |
| 3 | `executing-plans` | Works through tasks with review checkpoints |
| 4 | `subagent-driven-development` | Dispatches implementation work to isolated agents |
| 5 | `test-driven-development` | Enforces test-first development (three-scenario model) |
| 6 | `coding-discipline` | Enforces simplicity and surgical changes during all code writing |
| 7 | `systematic-debugging` | Root cause investigation before fixes |
| 8 | `verification-before-completion` | Evidence before claims — no success without verification |
| 9 | `requesting-code-review` | Dispatches reviewer subagent before merge |
| 10 | `receiving-code-review` | Prevents blind agreement with review feedback |
| 11 | `dispatching-parallel-agents` | Solves independent problems concurrently |
| 12 | `using-git-worktrees` | Creates isolated branch workspaces |
| 13 | `finishing-a-development-branch` | Presents merge/PR/keep/discard options |

**2 extensions** that run silently in the background:
- **Workflow Monitor** — warns on TDD violations, tracks debug cycles, gates commits on verification, tracks workflow phase, and serves reference content on demand.
- **Plan Tracker** — tracks task progress with a TUI widget.

**Requires [pi-subagents](https://github.com/nicobailon/pi-subagents)** for subagent delegation:
- Provides the `subagent` tool used by workflow skills (implementer, reviewer, worker dispatch)
- Full-featured: chain/parallel modes, async execution, model fallback, skill injection, MCP integration
- Install separately: `pi install npm:pi-subagents`

**After installation**:
- Any time the agent writes a source file without a failing test, it gets a warning injected into the tool result.
- Any time it tries to `git commit` / `git push` / `gh pr create` without passing tests, it gets gated.
- During **Brainstorm**/**Plan**, writes are restricted to `docs/plans/` (writes elsewhere trigger a process violation).
- On the first tool output of a session (inside a git repo), the agent is shown the **current git branch (or detached HEAD short SHA)**.
- On the first write/edit of a session (inside a git repo), the agent is warned to **confirm it's on the correct branch/worktree** before continuing.
- **Subagent results** are tracked: file changes, test runs, and TDD violations from subagents feed into the workflow monitor.

The agent sees these warnings as part of its normal tool output — no configuration needed.

More detail:
- [`docs/oversight-model.md`](docs/oversight-model.md) — how skills + runtime enforcement work together, and how warnings escalate
- [`docs/workflow-phases.md`](docs/workflow-phases.md) — what each workflow phase permits (especially thinking-phase write boundaries)

## Install

**Prerequisite:** Install pi-subagents first:

```bash
pi install npm:pi-subagents
```

Then install this package from GitHub:

```bash
pi install git:github.com/ulusoyomer/pi-superpowers-plus
```

Or add to `.pi/settings.json` (project-level) or `~/.pi/agent/config.json` (global):

```json
{
  "packages": ["npm:pi-subagents", "git:github.com/ulusoyomer/pi-superpowers-plus"]
}
```

No configuration required. Skills and extensions activate automatically.

## Support

- Questions / support: https://github.com/ulusoyomer/pi-superpowers-plus/discussions
- Bugs: https://github.com/ulusoyomer/pi-superpowers-plus/issues/new/choose
- Feature requests: https://github.com/ulusoyomer/pi-superpowers-plus/issues/new/choose
- Upstream: https://github.com/coctostan/pi-superpowers-plus

## The Workflow

The skills guide the agent through a consistent development cycle:

```
Brainstorm → Plan → Execute → Verify → Review → Finish
```

| Phase | Skill | What Happens |
|-------|-------|--------------|
| **Brainstorm** | `/skill:brainstorming` | Refines your idea into a design document via Socratic dialogue |
| **Plan** | `/skill:writing-plans` | Breaks the design into bite-sized TDD tasks with exact file paths and code |
| **Execute** | `/skill:executing-plans` or `/skill:subagent-driven-development` | Works through tasks in batches with review checkpoints |
| **Verify** | `/skill:verification-before-completion` | Runs tests and proves everything works — evidence before claims |
| **Review** | `/skill:requesting-code-review` | Dispatches a reviewer subagent to catch issues before merge |
| **Finish** | `/skill:finishing-a-development-branch` | Presents merge/PR/keep/discard options and cleans up |

**Cross-cutting skills** active throughout all phases:

| Skill | When It's Used |
|-------|---------------|
| `/skill:coding-discipline` | During ALL code writing — enforces simplicity and surgical changes |
| `/skill:test-driven-development` | During execution — enforced by the TDD monitor |
| `/skill:systematic-debugging` | When tests fail repeatedly — enforced by the debug monitor |
| `/skill:using-git-worktrees` | Before execution — creates isolated branch workspace |
| `/skill:dispatching-parallel-agents` | When multiple independent problems need solving concurrently |
| `/skill:receiving-code-review` | When acting on review feedback — prevents blind agreement |

The **workflow tracker** shows progress in the TUI status bar as the agent moves through phases:

```
-brainstorm → ✓plan → [execute] → verify → review → finish
```

Phases are detected automatically from skill invocations, artifact writes under `docs/plans/`, and plan tracker initialization. At phase boundaries, the agent is prompted (once) with options to continue, start a fresh session, skip, or discuss.

## Extensions

### Workflow Monitor

Runs in the background observing every tool call and result. Zero configuration.

#### TDD Enforcement

Detects when the agent writes production code without a failing test and injects a warning into the tool result. The warning is advisory — a nudge to consider whether a test is needed, not a hard block. The agent's skill instructions and agent profiles include three-scenario TDD guidance (new feature → full TDD, modifying tested code → run existing tests, trivial change → use judgment).

**Tracks the TDD cycle:** RED → GREEN → REFACTOR → idle. Resets on `git commit`.

**TUI widget** shows the current phase, color-coded:
```
TDD: RED          (red)
TDD: GREEN        (green)
TDD: REFACTOR     (accent)
```

#### Debug Enforcement

Activates after **2 consecutive failing test runs** (excluding intentional TDD red verification). When active:
- Warns if the agent writes a fix without reading code first (investigation required)
- Counts fix attempts and escalates warnings at 3+
- Resets on test pass or commit

#### Verification Gating

Warns on `git commit`, `git push`, and `gh pr create` when the agent hasn't run passing tests. Requires a fresh passing test run before shipping. Automatically clears after successful verification. During active plan execution, verification prompts are suppressed to avoid disrupting flow.

#### Branch Safety (informational)

Inside a git repo, the workflow monitor also tries to prevent "oops I just edited main" mistakes:
- On the **first tool result** of a session, it injects `📌 Current branch: <branch-or-sha>`.
- On the **first write/edit** of a session, it injects a warning reminding the agent to confirm the branch/worktree with the user.

Outside a git repo, it stays silent.

#### Workflow Tracker

Tracks which workflow phase the agent is in and shows a phase strip in the TUI widget. Detection signals:
- Skill invocations (`/skill:brainstorming`, `/skill:writing-plans`, etc.)
- Artifact writes under `docs/plans/` (`*-design.md` → brainstorm, `*-implementation.md` → plan)
- `plan_tracker` init calls → execute phase
- Passing test runs during verify phase → verify complete

At phase boundaries, prompts the agent once (non-enforcing) with options:
1. **Next step** — continue in the current session
2. **Fresh session** — hand off to a new session via `/workflow-next`
3. **Skip** — skip the next phase
4. **Discuss** — keep chatting

When transitioning into **finish**, the monitor pre-fills the editor with a reminder to consider documentation updates and to capture learnings before merging/shipping.

The `/workflow-next` command starts a new session with artifact context:
```
/workflow-next plan docs/plans/2026-02-10-my-feature-design.md
/workflow-next execute docs/plans/2026-02-11-my-feature-implementation.md
/workflow-next verify
```

Valid phases: `brainstorm`, `plan`, `execute`, `verify`, `review`, `finish`.

#### Reference Tool

Serves detailed guidance on demand, keeping skill files lean while making reference content available when the agent needs it:

```
workflow_reference({ topic: "tdd-rationalizations" })    - Why order matters, excuse table
workflow_reference({ topic: "tdd-examples" })             - Good/bad code examples, bug fix walkthrough
workflow_reference({ topic: "tdd-when-stuck" })           - Blocker solutions, verification checklist
workflow_reference({ topic: "tdd-anti-patterns" })        - Mock pitfalls, test-only methods
workflow_reference({ topic: "debug-rationalizations" })   - Why investigation-first matters
workflow_reference({ topic: "debug-tracing" })            - Root cause tracing technique
workflow_reference({ topic: "debug-defense-in-depth" })   - Multi-layer validation after fix
workflow_reference({ topic: "debug-condition-waiting" })  - Replace timeouts with conditions
```

### Plan Tracker

The `plan_tracker` tool stores task state in the session and shows progress in the TUI:

```
Tasks: ✓✓→○○ (2/5)  Task 3: Recovery modes
```

```
plan_tracker({ action: "init", tasks: ["Task 1: Setup", "Task 2: Core", ...] })
plan_tracker({ action: "update", index: 0, status: "complete" })
plan_tracker({ action: "status" })
plan_tracker({ action: "clear" })
```

## How Skills and Extensions Work Together

Skills are markdown files the agent reads to learn *what* to do. Extensions are TypeScript modules that *enforce* the discipline in real time.

| Agent Behavior | Skill (teaches) | Extension (enforces) |
|---|---|---|
| Write test before code | `test-driven-development` (three-scenario) | TDD monitor warns on violation (advisory) |
| Investigate before fixing | `systematic-debugging` | Debug monitor warns on fix-without-investigation |
| Run tests before claiming done | `verification-before-completion` | Verification gate warns on commit/push/PR |
| Keep code simple and diffs clean | `coding-discipline` (simplicity + surgical changes) | — |
| Follow workflow phases | All skills cross-reference each other | Workflow tracker detects phases, prompts at boundaries |
| Dispatch implementation work | `subagent-driven-development` | Subagent extension spawns isolated agents |
| Review before merge | `requesting-code-review` | Subagent dispatches code-reviewer agent |

The orchestrating agent's enforcement is advisory (warnings injected into tool results).

## Subagent Dispatch

This package uses [pi-subagents](https://github.com/nicobailon/pi-subagents) for subagent execution. All `pi-subagents` features are available: chain/parallel modes, async execution, model fallback, skill injection, worktree isolation, MCP integration, and more.

### Required Agents

Workflow skills expect the following agents to be defined in `~/.pi/agent/agents/`:

| Agent | Purpose | Used by |
|-------|---------|----------|
| `implementer` | TDD implementation | `subagent-driven-development` |
| `worker` | General-purpose task execution | `dispatching-parallel-agents` |
| `code-reviewer` | Production readiness review | `requesting-code-review`, `subagent-driven-development` |
| `spec-reviewer` | Plan/spec compliance check | `subagent-driven-development` |

Agent definitions are standard pi-subagents markdown files with YAML frontmatter. See [pi-subagents docs](https://github.com/nicobailon/pi-subagents) for full configuration options (model, tools, extensions, skills, thinking, fallbackModels, etc.).

### Single Agent

```ts
subagent({ agent: "implementer", task: "Implement the retry logic per docs/plans/retry-plan.md Task 3", skill: "test-driven-development" })
```

### Parallel Tasks

```ts
subagent({
  tasks: [
    { agent: "worker", task: "Fix failing test in auth.test.ts" },
    { agent: "worker", task: "Fix failing test in cache.test.ts" },
  ],
  worktree: true,
  concurrency: 2,
})
```

### Structured Results

Single-agent results from pi-subagents include:
- `filesChanged` — list of files written/edited
- `testsRan` — whether any test commands were executed
- `status` — `"completed"` or `"failed"`
- `tddViolations` — count of TDD violations detected

These are consumed by the workflow monitor to track progress.

### Custom Agents

Add `.md` files to `~/.pi/agent/agents/` (user-level) or `.pi/agents/` (project-level). See [pi-subagents documentation](https://github.com/nicobailon/pi-subagents) for the full agent frontmatter schema:

```yaml
---
name: my-agent
description: What this agent does
tools: read, write, edit, bash
model: claude-sonnet-4-5
fallbackModels: openai/gpt-5-mini, anthropic/claude-sonnet-4
thinking: high
skills: safe-bash
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
maxSubagentDepth: 1
---

System prompt body here.
```

## Compared to Upstream

Based on [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent, ported to pi as [pi-superpowers](https://github.com/coctostan/pi-superpowers), then extended with active enforcement and subagent integration.

| | [Superpowers](https://github.com/obra/superpowers) | [pi-superpowers](https://github.com/coctostan/pi-superpowers) | **ulusoyomer/pi-superpowers-plus** |
|---|---|---|---|
| **Platform** | Claude Code | pi | pi |
| **Skills** | 12 workflow skills | Same 12 skills (pi port) | **13 skills** (+ `coding-discipline`) |
| **Subagent integration** | — | Bundled extension | [pi-subagents](https://github.com/nicobailon/pi-subagents) (external) |
| **TDD enforcement** | Skill tells agent the rules | Skill tells agent the rules | Extension *watches* and injects warnings |
| **TDD widget** | — | — | TUI: RED → GREEN → REFACTOR |
| **Debug enforcement** | Manual discipline | Manual discipline | Extension escalates after repeated failures |
| **Verification gating** | — | — | Blocks commit/push/PR until tests pass |
| **Workflow tracking** | — | — | Phase strip, boundary prompts, `/workflow-next` |
| **Coding discipline** | — | — | Simplicity First + Surgical Changes |
| **Reference content** | Everything in SKILL.md | Everything in SKILL.md | Inline + on-demand `workflow_reference` tool |
| **Plan tracker** | — | — | `plan_tracker` tool with TUI progress widget |

## Architecture

```
pi-superpowers-plus/
├── extensions/
│   ├── logging.ts                     # File-based diagnostic logger
│   ├── plan-tracker.ts                # Task tracking tool + TUI widget
│   ├── workflow-monitor.ts            # Extension entry point (event wiring)
│   └── workflow-monitor/
│       ├── async-subagent-monitor.ts  # Async subagent result polling
│       ├── tdd-monitor.ts             # TDD phase state machine
│       ├── debug-monitor.ts           # Debug mode escalation
│       ├── verification-monitor.ts    # Commit/push/PR gating
│       ├── workflow-tracker.ts        # Workflow phase tracking
│       ├── workflow-transitions.ts    # Phase boundary prompt definitions
│       ├── workflow-handler.ts        # Testable core logic (combines monitors)
│       ├── heuristics.ts             # File classification (test vs source)
│       ├── test-runner.ts            # Test command/result detection
│       ├── investigation.ts          # Investigation signal detection
│       ├── git.ts                    # Git branch/SHA detection
│       ├── warnings.ts              # Violation warning content
│       ├── skip-confirmation.ts      # Phase-skip confirmation logic
│       └── reference-tool.ts        # On-demand reference loading
├── skills/                           # 13 workflow skills
│   ├── brainstorming/
│   ├── coding-discipline/            # NEW — simplicity + surgical changes
│   ├── dispatching-parallel-agents/
│   ├── executing-plans/
│   ├── finishing-a-development-branch/
│   ├── receiving-code-review/
│   ├── requesting-code-review/
│   ├── subagent-driven-development/
│   ├── systematic-debugging/
│   ├── test-driven-development/
│   ├── using-git-worktrees/
│   ├── verification-before-completion/
│   └── writing-plans/
└── tests/                            # 354 tests across 32 files
```

## Development

```bash
npm test                    # Run all tests
npx vitest run tests/extension/workflow-monitor/tdd-monitor.test.ts   # Run one file
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Attribution

- Skill content adapted from [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT)
- Active enforcement extensions and workflow tracking from [pi-superpowers-plus](https://github.com/coctostan/pi-superpowers-plus) by coctostan
- `coding-discipline` skill inspired by [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls

## License

MIT — see [LICENSE](LICENSE) for details.
