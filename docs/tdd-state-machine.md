# TDD Monitor State Machine

Developer reference for the workflow-monitor extension's TDD phase tracking.

## Phases

| Phase | Meaning | Entry Condition |
|-------|---------|-----------------|
| `idle` | No TDD activity | Initial state, or after `git commit` |
| `red-pending` | Test written, not yet run | Test file written (write/edit to `*.test.*`) |
| `red` | Test run, failing | First test run after `red-pending` (fail result) |
| `green` | Tests passing | Test pass in `red`, `red-pending`, or `refactor` |
| `refactor` | Refactoring with green tests | Source file edit while in `green` |

## Transitions

```
idle ──[test file written]──→ red-pending
red-pending ──[test run, fail]──→ red
red-pending ──[test run, pass]──→ green
red ──[test pass]──→ green
red ──[test file written]──→ red-pending
green ──[source edit]──→ refactor
green ──[test file written]──→ red-pending
refactor ──[test pass]──→ green
any ──[git commit]──→ idle
```

## Violations

| Violation | Phase | Trigger | Meaning |
|-----------|-------|---------|---------|
| `source-before-test` | `idle` | Source file written with no test files in session | Wrote production code without any test context |
| `source-during-red` | `red-pending` | Source file written | Wrote production code before running the new test |

**Note:** Source edits in `red` phase (after test has been run) are allowed — the developer is making the failing test pass.

## DebugMonitor Interaction

The DebugMonitor only activates when TDD phase is `idle`. During active TDD (any phase ≠ `idle`), test failures are TDD's domain. This prevents false "fix-without-investigation" warnings during normal RED→GREEN work.
