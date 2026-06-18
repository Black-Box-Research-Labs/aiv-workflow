---
name: ground-yourself
description: Force yourself to write down a grounded understanding of the current task before acting. Two modes - full architectural grounding (default) or scope translation. Use before any non-trivial code change, when the user invokes "ground yourself", asks "do you have full understanding of how this work fits", or asks "help me understand what is this PR why is it here" (scope mode).
---

# Ground yourself - two modes

This skill has two modes. **Pick the right one based on what the user actually asked.**

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). Keys used: `docs.architecture` (the project's architecture / design doc,
> default `docs/ARCHITECTURE.md`), `review.spec_sections` (map of named §-sections this skill can
> point at, default empty), `ci.local_replica_cmd` / `ci.test_cmd` / `ci.e2e_cmd` (the project's CI
> gates), `memory.dir` (default auto). If the file is absent, use these
> defaults and say so.

## Mode selection

| User said something like… | Mode |
|---|---|
| "do you have a full understanding of how this work fits into the global picture / blast radius / how to know you're on the right track / systematic analysis" | **`architecture`** (full 4-section) |
| "ground yourself" with no qualifier | `architecture` (default) |
| "help me understand what is this PR why is it here" | **`scope`** (2-section operator-language summary) |
| "what is this PR" / "why is this here" / "explain this PR in plain English" | `scope` |
| User invoked `/ground-yourself scope` explicitly | `scope` |

**When in doubt, pick `architecture`.** It's more thorough; the user will tell you if they wanted scope mode instead.

---

## Mode `architecture` - full grounding

Before you touch code, answer all 4 questions IN WRITING. No shortcuts.

### 1. Global picture

How does this work fit into the codebase as a whole? Name:
- the current project stage / milestone (whatever this project tracks progress against)
- the immediate predecessor change(s) / PR(s)
- the immediate successor change(s) or follow-ups
- the architectural section this belongs to in the project's architecture doc
  (`docs.architecture`, default `docs/ARCHITECTURE.md`); if the project maps named sections in
  `review.spec_sections`, name the section by its key

If you cannot name these, read the architecture doc (`docs.architecture`) first; if the project keeps
a separate codebase-understanding scratch doc, read that too.

### 2. Blast radius

What breaks if this change is wrong? Enumerate:
- which files / modules consume the surface being changed
- which of the project's CI gates would catch a regression (the gate set in `ci.*` -
  `ci.local_replica_cmd`, `ci.test_cmd`, `ci.e2e_cmd`, any `ci.checks`, plus the `aiv` pre-commit /
  pre-push hook installed by `aiv init`)
- which gates would NOT catch (manual-only checks, operator-runtime checks, smoke tests)
- whether the change crosses a project-stage boundary (substrate already shipped vs work that belongs
  to a later milestone)

### 3. How to know it's working

What's the falsifiable success signal? Name:
- the test(s) that go from red to green
- the CLI invocation that produces a different output
- the CI gate that flips status
- the artifact (file path) whose contents change

"It compiles" is not a success signal. "Typecheck clean" is not a success signal. **Behavior-level signal only.**

### 4. Systematic analysis vs the claim the system makes

For non-trivial changes, name BOTH:
- the **systematic** view - types, dependencies, dataflow, gate ordering
- the **claim** view - what claim does the system now make that it couldn't before this change? How
  is that claim defensible later, when someone the system serves (a consumer, an auditor, a target of
  the system's output) pushes back on it? Trace the chain that defends it (cause → artifact →
  version → evidence → commit).

If you can only answer one, you don't yet understand the change. Re-read.

### After answering

Report to user:
- "Grounding (architecture): complete" - proceed (or pass back to the PR-start flow)
- "Grounding (architecture): gaps in [list]" - surface gaps + ask user to fill them OR point you at a source-of-truth doc

---

## Mode `scope` - operator-language PR summary

This is a different question. The user wants a short, plain-English description of the change for someone who doesn't read code - themselves at a glance, or an operator/auditor reviewing later.

Answer 2 sections only. No more.

### 1. What this PR is

2-4 sentences:
- The problem it solves (named - what was broken, missing, or hard before)
- The mechanism (what code/doc/config actually changes)
- Who it serves (operator, the system's pipeline, a future change that consumes it)

Plain English. **No file names. No function names. No spec section numbers.** Translate them into the thing they do.

### 2. What this PR is NOT

2-3 bullets naming things people might assume this PR does but it doesn't:
- "This does not add [adjacent feature]"
- "This does not change [adjacent surface]"
- "[Later-milestone work X] is out of scope - comes in a later change"

This section prevents the downstream-misread failure: a consumer or auditor reading more into what
was claimed than the change actually delivered.

### After answering

Report: "Scope (operator-language) summary above. Want the full architectural grounding (mode `architecture`)?"

---

## Anti-patterns

- **Skipping any of the 4 architecture sections** in `architecture` mode because "it's obvious." If it were obvious you wouldn't need the skill.
- **Answering in your head.** Write it out. The writing forces precision.
- **Firing `architecture` mode when the user asked the short form.** That's overkill and signals you don't read user prompts carefully. The short form "what is this pr why is it here" wants `scope` mode, not 4 architectural sections.
- **Firing `scope` mode when the user asked the long form.** That's under-delivery on the actual architectural concern.
- **"The claim view" = "users want this feature."** That's product framing. The right framing: what claim does the system now publish, and how does the provenance chain (cause → artifact → version → evidence → commit) defend that claim later?
- **Treating CI green as the success signal in architecture mode.** CI catches some regressions, not all. Name the behavioral signal too.

## Principles this skill enforces (universal, not project-specific)

- A grounding written down is testable; a grounding held in your head is not. The act of writing is
  the gate, not a formality.
- "Looks obvious" is exactly when a missing dimension hides. If section 2 (blast radius) or section 4
  (the claim view) feels trivial, that is the signal to slow down, not speed up.
- A claim with no defensible provenance chain is a hypothesis the system is publishing as fact. If
  you cannot trace cause → artifact → version → evidence → commit, the change is not yet grounded.
