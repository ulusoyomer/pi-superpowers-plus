---
name: coding-discipline
description: Use during ALL code writing, editing, and refactoring — enforces simplicity and surgical changes to prevent overengineering, bloated abstractions, and unnecessary diffs.
---

> **Related skills:** Start with `/skill:brainstorming` to clarify intent. Use `/skill:test-driven-development` during implementation. Verify with `/skill:verification-before-completion`.

# Coding Discipline

## Overview

LLMs systematically overcomplicate code and make unnecessary changes. Two principles counter this tendency:

1. **Simplicity First** — Write the minimum code that solves the problem.
2. **Surgical Changes** — Touch only what the task requires.

These are not suggestions — they are constraints. Violating them produces bloated, unmaintainable code and noisy diffs.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks (simple typo fixes, obvious one-liners), use judgment — not every change needs the full rigor.

## Boundaries
- Read code: yes
- Edit or write code: yes (but within these constraints)
- Run verification: yes

---

## Principle 1: Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

### Rules

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- No "while I'm here" improvements.
- If you write 200 lines and it could be 50, rewrite it.

### The Test

> Would a senior engineer say this is overcomplicated?

If yes, simplify. If you're not sure, it's probably overcomplicated.

### Over-Abstraction Detection

Before adding any abstraction layer (class hierarchy, strategy pattern, factory, plugin system), answer:

| Question | If NO |
|----------|-------|
| Is there more than one current use case? | Don't abstract — use a function |
| Did the user ask for extensibility? | Don't add it |
| Does the abstraction reduce total lines? | Don't add it |
| Is this the simplest way to solve the problem? | Simplify |

### Speculative Feature Detection

Before adding any code not explicitly requested, check:

- Is this error case actually possible in practice?
- Was caching/async/retry/logging/monitoring requested?
- Am I adding this "just in case"?
- Am I solving a problem the user didn't describe?

If any answer is "yes, but they didn't ask" — don't add it.

### Examples

**❌ Overengineered** (30+ lines for a simple calculation):
```python
class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount: float) -> float: pass

class PercentageDiscount(DiscountStrategy):
    def calculate(self, amount: float) -> float:
        return amount * (self.percentage / 100)

class FixedDiscount(DiscountStrategy):
    def calculate(self, amount: float) -> float:
        return min(self.fixed_amount, amount)
```

**✅ Simple** (what was actually asked):
```python
def calculate_discount(amount: float, percent: float) -> float:
    return amount * (percent / 100)
```

**When to add complexity:** Only when you actually need multiple discount types. If that requirement comes later, refactor then.

---

## Principle 2: Surgical Changes

**Touch only what you must. Clean up only your own mess.**

### Rules

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

### The Test

> Every changed line should trace directly to the user's request.

If a changed line doesn't trace back to what was asked, it shouldn't be in the diff.

### Diff Hygiene Checklist

Before finalizing any change set:

- [ ] Every changed line traces to the user's request
- [ ] No reformatted code that wasn't touched by the actual change
- [ ] No comment changes unless the comments were wrong
- [ ] No "improved" variable names in untouched code
- [ ] No added docstrings to functions you didn't modify
- [ ] No reordered imports unless new imports were needed
- [ ] Dead code you noticed but wasn't asked to remove → mentioned, not deleted

### Examples

**User Request:** "Fix the bug where empty emails crash the validator"

**❌ Too Much** (drive-by refactoring):
```diff
  def validate_user(user_data):
-     # Check email format
-     if not user_data.get('email'):
+     """Validate user data."""
+     email = user_data.get('email', '').strip()
+
+     # Validate email
+     if not email:
          raise ValueError("Email required")
-     if '@' not in user_data['email']:
+     if '@' not in email or '.' not in email.split('@')[1]:
          raise ValueError("Invalid email")
-
-     if not user_data.get('username'):
+     username = user_data.get('username', '').strip()
+     if not username:
          raise ValueError("Username required")
+     if len(username) < 3:
+         raise ValueError("Username too short")
```

Problems: Added docstring, "improved" email validation beyond the fix, added username validation nobody asked for, changed comments.

**✅ Surgical** (only fixes the reported bug):
```diff
  def validate_user(user_data):
      # Check email format
-     if not user_data.get('email'):
+     if not user_data.get('email', '').strip():
          raise ValueError("Email required")
      if '@' not in user_data['email']:
          raise ValueError("Invalid email")
```

One line changed. The bug (empty string crashes) is fixed. Nothing else touched.

---

## Red Flags — STOP and Simplify

If you catch yourself:

- Adding a class hierarchy for a single implementation
- Creating a config/options object with defaults for a function with 2 parameters
- Adding error handling for cases that can't happen
- Building a plugin/strategy/factory system for one use case
- "This will be useful later" (YAGNI)
- Writing a function that accepts 4+ parameters
- Creating an interface with one implementation
- Adding logging, caching, or retry logic nobody asked for
- Reformatting code adjacent to your actual change
- Adding docstrings to functions you didn't modify
- Renaming variables in code you're not actually changing

**STOP. Remove the unnecessary code. Start simpler.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This makes it more flexible for future changes" | Future changes are hypothetical. Solve today's problem. |
| "I'm adding best practices" | Best practices serve the code, not the other way around. |
| "The abstraction is cleaner" | Cleaner than what? A function call? |
| "I should handle edge cases" | Edge cases the user didn't mention are speculative. |
| "The existing style is inconsistent" | Not your task. Match it, don't fix it. |
| "This dead code should be removed" | Mention it, don't delete it — unless asked. |
| "Just a small improvement while I'm here" | Scope creep in disguise. |
| "It's only a few extra lines" | A few extra lines × every change = bloated codebase. |

## Integration with Other Skills

This skill complements the existing workflow:

| Situation | Use this skill alongside |
|-----------|------------------------|
| Before building anything | `/skill:brainstorming` first, then apply simplicity here |
| During TDD implementation | `/skill:test-driven-development` for test order, this for code discipline |
| While editing existing code | Apply surgical changes to keep diffs clean |
| Before committing | `/skill:verification-before-completion` to verify, check diff hygiene here |
| During code review | `/skill:requesting-code-review` to catch violations |

## When To Apply

**ALWAYS when:**
- Writing new code
- Editing existing code
- Refactoring
- Fixing bugs
- Adding features

**Use judgment for:**
- Trivial one-line fixes
- Obvious typo corrections
- Mechanical changes (rename everywhere)

The goal is reducing costly mistakes on non-trivial work, not slowing down simple tasks.
