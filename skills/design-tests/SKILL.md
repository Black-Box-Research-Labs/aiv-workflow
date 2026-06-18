---
name: design-tests
description: Design high-leverage tests for untested or legacy code by building a bug catalog first, then matching each bug to the cheapest test type that catches it. Each test must name the bug it would catch. Use when adding tests to brownfield code, planning a test strategy before refactoring, asked "what tests should we write for X?", or invoked with phrases like "design tests", "test plan", "pin behavior", or "characterize" a file or module.
---

# Design Tests

A test earns its keep only if it would **fail when a real bug is introduced** and **not fail under a behavior-preserving refactor**. A high test count doesn't mean safety - only specific, well-aimed tests do.

This skill builds a **bug catalog before writing any tests**, then maps each bug to the cheapest test type that catches it. Output: a `<file>.bug-catalog.md` next to the test file, plus tests where every description names the bug it catches.

> **Config (optional).** This skill is pure methodology and touches no AIV substrate, so it runs
> standalone. If a `.aiv-workflow.yml` exists at the repo root (`git rev-parse --show-toplevel`;
> override via `$AIV_WORKFLOW_CONFIG`), use `ci.test_cmd` (default `npx vitest run`) to run the tests
> you design. If the file is absent or the key is unset, fall back to whatever test runner the
> project already uses (auto-detect from `package.json` / lockfile) and say which you chose.

## The bar - every test must clear all four

1. Would **fail** if a real, non-trivial bug were introduced.
2. Would **not fail** under a refactor that preserves behavior.
3. Tests **observable behavior**, not implementation.
4. Uses the **public interface** or documented contract.

If a test fails any of the four, don't write it. See [ANTI-PATTERNS.md](ANTI-PATTERNS.md).

## Process

### 1. Read the code (don't skim)

Read the target file or module end-to-end. **Follow type imports.** A magic string in a comparison usually has its semantics defined in a sibling type file - `"ACTIVE"` looks like an arbitrary string until you find `Status = "ACTIVE" | "ARCHIVED"` and realize it's a deliberate two-state model. Reading just the file misses this; reading the file plus its type imports catches it.

Produce a written summary covering all five:

- **Public interface**: exports, HTTP routes, CLI flags, DOM events - whatever the contract surface is.
- **Load-bearing comments**: comments that explain *why*, not *what*. Often signal invariants someone learned the hard way.
- **IO boundaries**: file system, HTTP, DB, randomness, time. These are where bugs concentrate.
- **Branching points**: every fast-path return, every dispatch-by-enum (`if/else if` or switch on a tagged value), every conditional that mutates output shape. **List them - they are pre-bug-catalog candidates.** Most bugs in pure functions live at branches; most bugs in data flow live at IO boundaries.
- **Type definitions of any magic-string contract**: if the file does `x.status === "FOO"`, find the type of `x.status`. Often a sibling type file reveals the contract is `"FOO" | "BAR"` and disambiguates whether `"FOO"` is a deliberate state or a stale literal.
- **Existing tests, if any**: not to copy, but to see which behaviors the prior author thought worth testing.

If the file is over ~500 lines, be willing to spend 30+ minutes here. **Skipping this step is the dominant failure mode of bad test design.** If you can't write the six-section summary in your own words, you read the code wrong - re-read.

### 2. Build the bug catalog

Use [BUG-CATALOG-TEMPLATE.md](BUG-CATALOG-TEMPLATE.md). For each plausible bug, capture:

- **The bug** in one sentence - the *failure mode*, not "X is broken."
- **Blast radius** - what real-world thing fails when this bug ships.
- **Why it's plausible** - what shape of code makes this a real risk, not theoretical.
- **The test type(s)** that would catch it (composition allowed - see step 3).

Rank by blast radius x plausibility. Don't enumerate exhaustively - focus on bugs that would actually hurt.

**Required deliverable: a "Skipped" section.** List bugs you considered but explicitly chose not to test, with reasons (trivial / cosmetic / out of scope / deferred until X). Half the value of the catalog is the *negative space* - the explicit "we know this exists, we chose not to cover it" record. Future-you will thank you.

### 3. Match each bug to a test type (composition allowed)

| Test type | When to use | What it catches |
|---|---|---|
| **Property-based** (fast-check, hypothesis) | The bug is *a class of inputs* breaking the same invariant - ordering, merge symmetry, dispatch tables, normalization | A whole class of regressions, not one example. Often catches edge cases the author didn't think to write. **Reach for this first** when the input space is bounded but larger than ~5 explicit cases. |
| **Invariant** | Code has load-bearing rules ("X always holds") | Whole classes of regressions for that rule |
| **Round-trip** | Code is bidirectional: encode/decode, save/load, merge | Asymmetric bugs, field loss |
| **Differential** | Code routes input through transforms | "Did this variable thread through?" |
| **Captured bug / contract pin** | A past real failure, or a magic-string contract that needs to break visibly when changed | That specific bug returning, or a silent-rename regression |
| **Negative path** | Inputs can be invalid | Silent corruption vs. explicit error |
| **Decision table** | Output shape depends on a small Cartesian product of input flags | All branches of the dispatch logic |

**Composition is fine and often correct.** A single test can be invariant *and* property-based ("for any valid order, the receipt contains all three required line items"). Don't split into two tests just to fit one row of the table - the *bug* is the unit of test design, not the type.

**Snapshot tests are not on this list.** Snapshots detect *change*, not *correctness* - they pass for wrong-but-stable output. Use them only as a backstop next to a semantic test that does the real work.

**Property-based testing is not optional when applicable.** If the input space has more than ~5 distinct shapes and the invariant is checkable algorithmically, write the property test instead of (or in addition to) hand-picked cases. Hand-picked cases reflect what the *author thought of*; property tests find what the author didn't.

### 4. Self-critique every proposed test

Before writing test code, answer in the catalog file, for each test:

- **What specific catalog bug does this catch?** If the answer is hand-wavy, the test is hand-wavy.
- **Would this pass for wrong-but-stable output?** If yes, it's snapshot-disguised - strengthen the assertion.
- **Would this fail under a non-behavior-changing refactor?** If yes, it's implementation-coupled - assert on output, not on internal calls.

If a test fails the self-critique, fix the design now, not after writing code.

### 5. Write tests one at a time

Apply Pocock's red->green discipline to brownfield:

1. Pick the highest-blast-radius bug from the catalog.
2. Write *one* test for it.
3. Run it. Three possible outcomes:
   - **Pass** -> behavior is characterized; the bug isn't present today. Move to next.
   - **Fail** -> the bug is real and currently present. **Stop. Fix the bug before writing more tests.** Don't pile characterization on top of broken behavior. When a test fails, decide which side is wrong *before* editing either - never edit the test just to make it green.
   - **Pass + suspect** -> test passes today, but during writing you noticed the contract being pinned looks fragile, brittle, or possibly wrong (hardcoded set that should be a constant; magic string that probably should be an enum; a default that papers over missing data). **Note in the catalog as a re-evaluation target; do not block on it.** Don't conflate "current behavior is characterized" with "current behavior is correct" - sometimes you're pinning a bug nobody's noticed yet.
4. Move to the next bug.

Each test's description must name the bug it catches:

```
test("round-trip POST preserves existing fields not mentioned in body - guards against per-field-merge-omission", ...)
```

A reader six months later should know what the test is *for*, not just what it does.

### 6. Final evaluation

After the test suite is written, fill in the catalog's evaluation section:

- **Bugs caught** (test failed first run, fix needed).
- **Bugs characterized** (test passed first run, behavior pinned).
- **Bugs discovered during writing** that weren't in the original catalog.

If the answer to "bugs caught" is zero, the catalog was built from theoretical bugs, not real ones. **Re-read the code with more skepticism** - most untested production code has at least one real bug per ~500 LOC. If you find none, you're not looking hard enough or the code is unusually disciplined.

### 7. Investigation pass on suspect findings

Before declaring done, examine each "pass + suspect" item and each "0 bugs caught" claim **adversarially**. A verifier that compares output only to its own source will false-PASS while both are broken; "looks perfect" usually means a missing measurement dimension - add it, re-probe, then conclude.

- For each pass+suspect: is this *actually* a bug, or did I miss context (type definition, sibling file, downstream guard)? Often the answer is "I didn't read enough." Common resolutions:
  - **Retract** - investigation reveals the contract is correct as-is.
  - **Confirm and elevate** - investigation reveals a real bug nobody noticed; flip status to caught.
  - **Downgrade** - risk is bounded by a downstream guard (input sanitization, validator), so the upstream test was over-cautious.

- For "0 bugs caught": list **2-3 bug classes you didn't enumerate** and probe at least one. Common omissions: input encoding/escaping, cross-feature composition, type-confusion at boundaries, magic-string contracts. Probe with a quick experimental input (e.g., a short script piping a hostile user-supplied string through the function) before declaring the catalog complete.

Update the catalog with the investigation results. The post-investigation final stats are the honest ones - the pre-investigation numbers are usually too modest *or* too generous.

## What to skip

- **Trivial functions** (parseInt wrappers, simple lookups). Their bugs are immediately visible.
- **Code about to be deleted or rewritten.** Don't pin behavior we're discarding.
- **Files where the public interface is unstable.** Stabilize the contract first.
- **Pure UI rendering with no logic.** Use visual or e2e tests at a different layer.

## Output artifact

Each session produces `<file>.bug-catalog.md` next to the test file. This is the durable record of *why* each test exists. Future-you reading the test six months later should be able to open the catalog and see the full reasoning. See [BUG-CATALOG-TEMPLATE.md](BUG-CATALOG-TEMPLATE.md).
