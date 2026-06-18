---
name: prove-it
description: Force the implementing agent to PROVE a change works with behavioral artifacts (rendered screenshots, end-to-end video/trace, before-after diffs against the cited baseline) before the review handoff, so the human is the final evidence JUDGE, not the verification layer. Runs on the build side after atomic commits land and tests are green. Binds every artifact to an AIV evidence class (A-F, address-all with honest N/A-rationale) and refuses to label anything PASS without an artifact an independent assessor confirms exercises the change. Distinct from launching-and-eyeballing the app (it binds to AIV classes and gates anti-theater) and from packet authoring (this is the evidence ENGINE that feeds the packet, not the formatter). Use when the user says "prove it works", "show it actually works", "produce the evidence", "demonstrate the change", "capture the integration/screenshot/video proof", or at the build->review seam. Output: artifact files under the configured evidence dir + a sha256 manifest + paste-ready packet blocks bound to each AIV class, with a per-claim verdict naming exactly what was shown vs left UNVERIFIED.
---

# Prove it - behavioral evidence the human only has to judge

You are the **implementing agent on the build side**, after atomic commits have landed and tests /
typecheck / lint are green. This skill is the **last thing you do before the review handoff**: it is
what makes the change reviewable by an independent reviewer who never hears your reasoning, and
judgeable by the one human left in the loop.

The failure mode this kills: **declaring "works / done / PASS" over a system you only
component-checked, an output you only HTTP-200'd, or a fix you only described in chat.** You
self-verify the cheap facts (typecheck clean, tests pass, counts) for free. The three dimensions
below are EXPENSIVE, so you skip them unless a gate forces you. This skill is that gate.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`;
> override via `$AIV_WORKFLOW_CONFIG`). Keys used: `aiv.evidence_dir` (default
> `.github/aiv-packets/evidence`), `aiv.cli` (default `aiv`), `prove_it.browser_runner` (default
> `playwright`), `prove_it.render_cmd`, `ci.e2e_cmd`, `evidence.exclude_classes` (default `[G]`). If
> the file is absent, use these defaults and say so.

> **The system this lives in:** the only human touchpoints are the initial audit that produced the
> finding and the final evidence judge. So the evidence you produce here is the substrate the human
> judge reads. Vacuous or absent evidence pushes verification work back onto the human and breaks the
> automation premise.

## The three dimensions you must FORCE (the cheap ones you get for free)

1. **Render-and-look** - for any UI / output / artifact change, render the actual operator-facing
   view and inspect the **image**. Not a 200, not a parse, not a count. The rendered pixels.
2. **End-to-end on the real system** - run the **composed** path (browser -> API -> data ->
   response, or CLI -> engine -> store -> emitted artifact), not isolated units. Capture a
   video/trace for any multi-step flow.
3. **Claim-to-cited-baseline** - diff every behavioral claim against the **exact ref the finding
   pins** (the same evidence chain that started in the launch brief), before-and-after. Never vs
   `HEAD`/the default branch unless that IS the cited ref.

## When NOT to invoke

- You just want to launch the app and look around, or manually sanity-check a fix: do that directly.
  This skill adds AIV-class binding and the anti-theater gate; reach for it when the artifacts must
  enter a packet.
- You want to FORMAT the packet: that is the `aiv-packet` skill (this is the engine that feeds it).
- You are auditing someone else's PR: that is `rigor-audit` / `or-review` / `aiv-audit` (review side,
  fresh context). This skill is build-side; the reviewer must never run it for you.

## Inputs

- The change's **behavioral claims** - from the launch brief's finding (with its line numbers / cited
  SHA) and the packet's claim list. Each claim is a thing that must be *shown* working.
- The **cited baseline ref(s)** the finding pins. If a claim has no cited baseline, it is a
  hypothesis, not a claim - flag it; do not invent one.
- The drafted (or in-progress) packet, so you know which classes need behavioral artifacts.

## The bar - every artifact must clear all four

1. It exercises the **actually-changed** code path (not an adjacent view that merely renders nearby).
2. It is captured from the **real composed system**, not a stub of the thing under test.
3. It is **diffed against the cited baseline**, so "different from before" is provable, not asserted.
4. An **independent assessor** (not you) confirms 1-3 on the artifact that will SHIP, not a draft.

If an artifact fails any of the four, it does not count as proof. The claim it supports is
`UNVERIFIED`, not `PASS`.

## Process

### P0 - Enumerate the behavioral claims
List every claim that asserts runtime behavior. For each, write: the claim, the cited baseline ref,
and the cheapest artifact type that would prove it at behavior level. Count them (N). Completeness is
measured against N.

> **GATE 0:** Every claim has a cited baseline and a chosen artifact type? Count N fixed?

### P1 - Match each claim to the cheapest proving artifact

| Change shape | Cheapest behavioral artifact | Primary AIV class |
|---|---|---|
| UI / page / rendered output | before+after **screenshot pair** of the actual view | A + D |
| Multi-step flow | **video + trace** of the composed flow (`prove_it.browser_runner`) | A + D |
| CLI verb / flag / emitted artifact | **captured invocation + stdout** + the emitted file before/after | A + D |
| Store write / schema / migration | **before/after dump**, bound to base+head SHA | D |
| API request/response contract | **captured request + response** at head, vs baseline shape | A + D |
| Pure logic / pure function | targeted **test run with counts** + the asserted output | A |

Prefer compact artifacts (a before/after PNG pair, a trace file) over raw multi-minute video where a
pair tells the whole story. Record a `sha256` for each. Large binaries: hash + store; if repo bloat
is a concern, surface it to the operator rather than silently committing hundreds of MB.

### P2 - Produce the artifact on the real system
- **Browser:** drive the composed flow with the configured runner (`prove_it.browser_runner`;
  `ci.e2e_cmd` for the harness). Screenshot the rendered view; keep the trace for a flow.
- **Render-and-look for static output:** render the operator-facing view (`prove_it.render_cmd`) and
  **inspect the PNG** - your own eyes on the image, not a status code.
- **CLI:** run the real verb with real flags against the real system; capture the exact invocation
  and full stdout to a file.
- **Before/after:** `git show <cited-SHA>:<path>` (or check out the cited baseline), capture "before",
  then capture "after" at head. The diff is the proof.

> **GATE 2:** Every rendered artifact viewed as an IMAGE? Flow run end-to-end on the real composed
> system (not components)? Each "after" paired with a "before" at the CITED ref?

### P3 - Anti-theater: you are never your own verifier on the proof
For each behavioral claim, spawn (a) an **adversarial probe** prompted to find a way the artifact does
NOT actually exercise the change, and (b) an **independent visual/behavioral assessor** that looks at
the SHIP artifact cold and says whether it shows the claimed behavior. Audit the version that ships,
not an earlier draft - the capture step itself introduces regressions (wrong route, stale build,
cached page). A claim survives only if both confirm.

> **GATE 3:** Independent assessor confirmed each artifact exercises the change on the SHIP version?
> Any artifact the adversarial probe broke -> claim back to UNVERIFIED.

### P4 - Bind to AIV classes (address-all, honest N/A)
Per the all-class evidence mandate, every packet addresses A-F (classes in `evidence.exclude_classes`
omitted - G by default, because automating a before-reading prediction is gaming). This skill
produces the **behavioral** classes and marks the rest honestly. For each class, emit either a real
artifact OR a one-line **falsifiable N/A rationale** - never an empty section, never vacuous filler.

| Class | What this skill supplies | Honest N/A looks like |
|---|---|---|
| **A** Execution | test run with pass/fail/skip counts + the rendered/captured output | (never N/A - every change runs something) |
| **B** Referential | each artifact SHA-pinned; claim->artifact map | (never N/A - claims always trace) |
| **C** Negative | declared-scope search showing the disallowed pattern is absent in the new flow | "no disallowed-pattern surface in this change - C N/A; scope searched: `<paths>`" |
| **D** Differential | before/after artifact bound to base+head SHA | "no runtime/output surface (docs-only) - differential N/A" |
| **E** Intent | the cited finding/issue ref, immutable | "intent = finding `<ref>`; immutable at SHA `<x>`" |
| **F** Provenance | `sha256` manifest of all artifacts above | "full provenance pending signing infra; sha256 manifest supplied" |

Validate the resulting packet through the tool, not by eye: run the project's configured
`aiv.check_cmd` (default `aiv check`) against the packet. Let the protocol tool confirm shape; your job is that the evidence is
*real*.

> **GATE 4:** Every class A-F has either a real artifact or a falsifiable N/A line? Zero empty
> sections, zero vacuous filler?

## Output

1. **Artifact files** under `aiv.evidence_dir` (co-located with packets so they are referenced by
   commit SHA and immutable): screenshots, traces, captured stdout, before/after dumps.
2. **A `MANIFEST.md`** in that dir: one row per artifact - path, `sha256`, the claim it proves, the
   cited baseline ref.
3. **Paste-ready packet blocks** - one per AIV class, for `aiv-packet` to drop into the packet's
   evidence section, each with its artifact reference and the claim it supports.
4. **A per-claim verdict table**: `claim -> PASS (artifact: ...)` or `-> UNVERIFIED (reason: ...)`.
   The verdict is the handoff signal: a change with any `UNVERIFIED` behavioral claim is **not ready
   for review**, and you say so plainly rather than shipping it as "done".

## The seam with the rest of the loop

- **`aiv-packet` consumes this.** This skill captures and hashes; `aiv-packet` formats the packet and
  validates it via the `aiv` CLI. Run `prove-it` first, then hand its blocks to `aiv-packet`.
- **The review entity never runs this.** Context isolation is the point: the reviewer gets the PR +
  the evidence artifacts, not your story. `prove-it` runs build-side so the artifacts exist *before*
  the isolated review begins.
- **`poll-ci` carries the signals back.** Once review fires, the impl agent polls for review/human
  findings; a finding that says "this claim isn't actually shown" sends you back to P1 for that
  claim. The loop terminates when every behavioral claim is `PASS` and CI is green.

## Anti-patterns

- **HTTP 200 / "it parses" / a count as proof of a rendered change.** Render and look at the image.
- **Component-checking and calling it end-to-end.** Run the composed system after the launcher exits.
- **Diffing against the default branch instead of the cited baseline.** Widest blast radius; diff
  against the ref the finding pins.
- **Being your own visual verifier.** Spawn the independent assessor on the SHIP artifact.
- **Manufacturing vacuous Class C/D/F to satisfy the mandate.** Address-all means *address*, with an
  honest falsifiable N/A where a class genuinely doesn't apply - not filler.
- **Shipping a change with `UNVERIFIED` claims as "done".** Name what you actually showed vs didn't.
- **Committing hundreds of MB of raw video silently.** Prefer compact trace + PNG pairs; surface
  repo-bloat tradeoffs to the operator.

## Principles this skill enforces (universal, not project-specific)

- "Looks perfect" usually means a missing measurement dimension. If an audit comes back clean, add
  the dimension that would have caught the defect, then re-run.
- A subprocess/daemon/external-system change needs a wall-clock end-to-end drill; unit tests miss
  what the composed run catches.
- A PASS verdict here is a *readiness* signal, not merge authority. The human is the merge gate.
