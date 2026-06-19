---
name: check-drift
description: Stress-test a plan in one shot across four phases - (0) R-tier classification + audit-depth gating, (1) structural drift against a tier-matched reference plan or canonical template, (2) plan-quality interrogation (design-tests, testability, verification pre-reads, automate-over-operator, code-health baseline, code-review resilience, memory coverage, fan-out trigger), and (3) plan-graph + temporal checks for R>=2 plans (base-SHA pin, conflicts-with scan, open-questions queue, streams structure, stop conditions, iter/wall-clock budget, plan revisions, session checkpoints, untouched files). Use when user says "check drift", "did we lose anything from [X]", "just double checking", "this is what a typical plan looks like - what are we missing", "double check this plan", or when an agent in plan mode has produced a plan and the operator wants to interrogate it before exiting plan mode.
---

# Check drift - 4-phase plan audit (ONE shot)

The skill bundles four phases because the operator naturally wants all of them but forgets to type past the first. Run all phases that apply at the plan's R-tier. Do not stop early.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). If absent, use the defaults named inline below and say so. Keys used:
> `plans.dir` (default `~/.claude/plans`), `plans.archetypes.{R0,R1,R2,R3}` (default blank),
> `memory.dir` (default `auto`), `memory.index` (default `MEMORY.md`),
> `review.spec_sections.{progress_tracker,iteration}` (default blank), `review.coord_file`,
> `branch.base` (default `origin/main`), `ci.local_replica_cmd`, `aiv.cli` (default `aiv`),
> `quality.code_health_cmd` (default blank - skip the per-file code-health sub-check),
> `quality.code_health_changeset_cmd` (default blank - skip the branch-level code-health sub-check),
> `quality.coverage_floor` (default blank - skip the explicit ratchet floor).

**Calibration source:** the project's own plan corpus under the configured plans dir (`plans.dir`,
default `~/.claude/plans`). The template below is *descriptive* (what the corpus's plans had), not
*closed* (what plans need) - see "Survivorship-bias disclosure" in output. Sections marked OPTIONAL
are observed-rare-but-load-bearing.

---

## Phase 0 - R-tier classification + audit-depth gating

Before anything else, classify the plan as R0/R1/R2/R3. This gates how much of phases 1-3 runs.

### 0a. Sources (in priority order)

1. **Plan declares it** in a `## 0. Plan-file metadata` block or in the configured progress-tracker
   row (`review.spec_sections.progress_tracker`) → use directly.
2. **Infer** from heuristics:
   - R0: <=3 commits, surface-only (middleware, doc fix, single-file hotfix)
   - R1: <=10 commits, no new substrate, no migrations
   - R2: 10-50 commits, OR new data-access methods OR new dispatcher OR a migration
   - R3: >50 commits OR parallel streams OR multi-subsystem OR capstone/closure naming
3. **Mismatch** between declared and inferred → ask the operator which.

### 0b. Audit-depth table

| R-tier | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| R0 | 1a-1c (skip series-gap check) | 2.1, 2.5 | skip |
| R1 | full | 2.1, 2.2, 2.3, 2.5, 2.8 | 3.1, 3.5 |
| R2 | full | full (2.1-2.8) | 3.1-3.6 |
| R3 | full | full (2.1-2.8) | full (3.1-3.9) |

Print the gate decision at the top of the output:

```
PHASE 0: R-TIER = R<N>
  Declared: <value or MISSING>
  Inferred: R<N> (basis: <N commits, M new files, K migrations, …>)
  Reconciled: <value> (ask if mismatch)
  Audit depth: phases <list>
```

---

## Phase 1 - Structural drift

### 1a. Identify the reference (priority order)

1. **User named one inline** ("compare against PR-X", "did we lose anything from [feature]") → match
   against `<plans.dir>/*.md`; closest filename wins; ask if ambiguous.
2. **User said "typical plan" / "the typical plan"** → use the **tier-matched archetype** (see 1b).
3. **User pasted current plan + named "previous version" / "what we agreed"** → most-recent prior
   version earlier in this conversation.
4. **Explicit file/git ref** → use directly.
5. **No reference identified** → use the tier-matched archetype, announce the substitution, and offer
   to switch if the operator names another.

### 1b. Tier-matched archetypes

Default reference when none is named - match the plan's R-tier against `plans.archetypes`:

| R-tier | Archetype path key |
|---|---|
| R0 | `plans.archetypes.R0` |
| R1 | `plans.archetypes.R1` |
| R2 | `plans.archetypes.R2` |
| R2 follow-up / closure / amendment | `plans.archetypes.R2_followup` (when blank, tier to R2 → `plans.archetypes.R2`) |
| R3 | `plans.archetypes.R3` |

A follow-up / closure / amendment plan tiers to `plans.archetypes.R2_followup`; when that key is
blank, fall back to the R2 archetype (`plans.archetypes.R2`).

If the matched archetype key is blank (the default), **disable structural-drift-vs-reference for
this run** and say so in one line: `1b: no R<N> archetype configured (plans.archetypes.R<N> blank) -
running section-presence + series-gap checks against the canonical list only, no reference diff.`
Section-presence and the numbered-series checks (1c/1d) still run; only the substantive
vs-reference diff is skipped.

### 1c. Canonical section list (22 elements, tiered)

| # | Section | Required at R |
|---|---|---|
| 0 | **Plan-file metadata** (R-tier, base-SHA, worktree, conflicts-with, coord file) | R2+ |
| 1 | **Context** | all |
| 2 | **Verified state (N Explore agents, YYYY-MM-DD)** | R1+ |
| 3 | **Pre-authoring verifications (checked against base `<SHA>`)** | R2+ |
| 4 | **Required prior-PR packet pre-reads** | R2+ |
| 5 | **Memory + lesson references** | R1+ |
| 6 | **Strict scope boundaries** (IN / OUT with dispositions / "does NOT do" philosophical) | all |
| 7 | **Locked design decisions** (D-numbered, operator-confirmed + date) | R1+ |
| 8 | **Open questions to resolve before B0** (with gate-status) | R2+ |
| 9 | **Sequenced atomic-commit plan** - flat B0…Bn (R0-R2) OR Streams a/b/g… (R3) | all |
| 10 | **Critical files** (NEW / MOD / **UNTOUCHED**) | R1+ |
| 11 | **Reused utilities (must consume, not reimplement)** ← literal phrase | R1+ |
| 12 | **Test strategy** - Layers A (unit) / B (integration) / C (E2E) / D (coverage ratchet) / E (local-CI replica) / F (operator-runtime drill) | R2+ |
| 13 | **Verification matrix** (criteria × surfaces) - distinct from checklist | R2+ when criteria >3 |
| 14 | **Acceptance criteria** (outcome-shaped, measurable) | R1+ |
| 15 | **Risks + mitigations + stop conditions (RED)** | R1+ |
| 16 | **Code-review resilience plan** | R2+ when prior automated-review contact |
| 17 | **Rituals applicable** (named skills + invocation order) | R2+ |
| 18 | **Iter / wall-clock budget** | R2+ |
| 19 | **Locked PR sequence position** (predecessor / successor / parallel-safe with) | all |
| 20 | **After-merge handoff** (progress-tracker row, memory writes, follow-up issues, coord checkpoint) | R1+ |
| 21 | **Session checkpoints** | R3 |
| 22 | **Plan revisions** (running log) | R2+ when revised |

### 1d. Run the structural diff

- **Section-presence**: missing required at tier; extras (non-canonical); out-of-order.
- **Numbered-series gap check** (R>=1): D-decisions / B-commits / R-risks / Q-questions /
  operator-decision dates - gaps, duplicates, renumbering drift.
- **Stream-structure check** (R3): parallel streams declared? per-stream commit counts? dependency
  arrows between streams? Without this, an R3 flat ledger is a structural fail.
- **Substantive diff** for CHANGED sections (vs reference, only when a reference is available per
  1b): categorize losses / additions / restructuring / wording-only. Wording-only does NOT get
  reported.

---

## Phase 2 - Plan-quality interrogation

Run the audits the tier table calls for. Answer each in writing.

> **Commitment, not existence (governs every sub-check below).** check-drift runs in plan mode,
> BEFORE design-tests, build, and prove-it. Any sub-check whose subject is an artifact those later
> stages produce (a `.bug-catalog.md`, a written test, a captured evidence file, a CI run) must
> verify the plan's **commitment to produce it** - the deliverable is named and assigned to a stage -
> NOT the artifact's existence (which is impossible at plan time and would block every otherwise-
> converged plan). The later stage's own gate enforces the physical artifact. A bare "we'll handle it"
> with no named per-artifact commitment still fails.

### 2.1 - Design-tests commitment (plan-time: commitment, not file existence)

check-drift runs in plan mode, BEFORE the build. A `<file>.bug-catalog.md` companion is produced
later by the `design-tests` skill, so it cannot exist yet at the plan gate. So 2.1 verifies the plan
**commits** to bug-catalog-first design-tests for each NEW/MOD critical file: the test-strategy /
acceptance sections name the per-file `<path>.bug-catalog.md` deliverable and state that
`design-tests` will produce it. It does NOT require the file to exist now (that is enforced later, at
the design-tests gate).

For each NEW/MOD critical file:

| File | Per-file bug-catalog commitment in the plan? | 2.1 verdict |
|---|---|---|
| `path/to/file.ts` | names `<path>.bug-catalog.md` + says design-tests produces it | PASS (file N/A at plan time) |
| `path/to/new.ts` | only "we'll write tests"; no per-file commitment | FAIL - add the per-file bug-catalog commitment |

A plan that names a per-file bug-catalog commitment PASSES 2.1, and the physical file is N/A here (it
is produced at the design-tests stage and does not count against convergence). A plan that merely says
"we'll write tests" with no per-file commitment still FAILS. Bug-catalog-first remains the standard:
at the plan gate it is a *commitment* requirement; at the design-tests gate it becomes a *file*
requirement.

### 2.2 - Testability split (three sub-checks)

**2.2a Verification matrix** (R2+ when criteria >3) - Is there a rows-criteria × cols-surfaces
matrix? Flat checklists for multi-criterion plans flatten the audit.

**2.2b Acceptance criteria vs verification** - Are outcome-shaped acceptance criteria distinct from
mechanical verification checks? "metric ratio >= 0.5" is acceptance; "tests pass" is verification.
Flag if collapsed.

**2.2c Test strategy layers** (R2+) - Are Layers A-F declared? Flag any layer-gap that has plausible
coverage:
- Layer A unit: always
- Layer B integration: required when a data-access / DB-write path is touched. *Principle: an
  in-memory DB surrogate accepts dialect-specific bugs the real engine rejects; exercise every
  DB-write path's happy path against the real database, not a surrogate.*
- Layer C E2E: required when UI/route/auth touched
- Layer D coverage ratchet: required when functional LOC added. If `quality.coverage_floor` is set,
  cite it; if blank, say "no coverage floor configured (quality.coverage_floor blank) - flag only
  that a ratchet layer is declared, not a numeric target."
- Layer E local-CI replica: required pre-push. *Principle: run the local-CI replica
  (`ci.local_replica_cmd`) before every push; never push knowing CI will fail and binary-search the
  remote.*
- Layer F operator drill: required when a subprocess/daemon/external-system is touched. *Principle: a
  subprocess/daemon/external-system change needs a wall-clock end-to-end drill; unit tests miss what
  the composed run catches.*

### 2.3 - Verification-packet pre-read

For each MOD file, decide: code-view sufficient OR packet pre-read required (name path + section).
Where the plan touches a previously-verified surface, the prior packets live under the AIV packets
dir - the plan should cite which it pre-reads.

### 2.4 - Automate-over-operator-validation

Every operator-confirmation step → propose a test surface. Examples that are NOT operator-only by
nature:
- TTS / audio pipeline → fault-injection test
- Runbook → integration test on the runbook's code path
- Login confirmation → browser flow

Flag every operator-only step with a plausible test surface. *Principle: a runbook or "operator
confirms" step that has a code path is testable; default to automating the check rather than parking
it on the human.*

### 2.5 - Code-health baseline + pre-merge regression gate

For every NEW/MOD file: pre-modification baseline + pre-merge re-measurement. A new RED introduced OR
a threshold-crossing drop blocks merge; fix in-PR.

| File | Baseline / RED | Plan recorded baseline? | Pre-merge re-measure phase? |
|---|---|---|---|
| `path/to/file.ts` | 9.2 / 0 RED | present §<N> | present Phase Z |
| `path/to/new.ts` | n/a (new) | n/a - measure post-first-commit | present Phase Z |
| `path/to/refactor.ts` | 7.8 / 1 RED | MISSING | MISSING - add before B0 |

**Tooling (per-file):** run the configured per-file code-health command (`quality.code_health_cmd`).
If it is blank (the default), **skip this sub-check** and say so in one line: `2.5: no per-file
code-health tool configured (quality.code_health_cmd blank) - skipped.`

**Tooling (branch-level pre-PR):** run the configured change-set code-health command
(`quality.code_health_changeset_cmd`) for a branch/change-set-level review before opening the PR. If
it is blank (the default), **skip this sub-check** and say so in one line: `2.5: no change-set
code-health tool configured (quality.code_health_changeset_cmd blank) - skipped.`

Where a code-health tool flags only structural smells, it
will miss content-level and concurrency-semantic bugs; pair it with the bug-catalog (2.1), never gate
on code-health alone.

### 2.6 - Fan-out trigger decision

State YES/NO + reasoning. YES if any of:
- 3+ critical files spanning subsystems
- Design depends on unverified codebase claims
- Spec citations need cross-checking against current impl
- New gates / CLI / env vars

If YES, propose angles; do NOT auto-fire. The operator confirms.

### 2.7 - Code-review resilience (R2+ when prior automated-review contact)

If `gh pr view <N> --json reviews` shows a prior automated-review-bot review, pre-empt expected
findings:
- List the bot's last-cycle actionables (count + categories)
- Disposition policy per category: fix-now / file-followup / mark intentional
- *Principle: don't re-trigger a full bot review after every push; the bot's auto-skip when it has
  nothing new IS the convergence signal.*

### 2.8 - Memory coverage

Grep the plan for memory citations (`feedback_*.md` / `project_*.md`, or the project's own naming).
Cross-check against the memory index (`memory.dir` / `memory.index`, default `auto` / `MEMORY.md`)
for universally-applicable lessons the plan should cite but doesn't. The lessons below are stated as
**universal principles** - flag a plan that violates the principle, whether or not the project keeps a
matching memory file:

| Principle | Applies to | Honored? |
|---|---|---|
| Never merge autonomously; the human is the merge gate | every PR with a merge gate | yes/no |
| Author verification packets to the configured shape; validate via the `aiv` CLI, not by eye | every packet author | yes/no |
| Merge by rebase, not squash (atomic commits land as-is) | every merge | yes/no |
| Run the local-CI replica before every push | every pre-push | yes/no when applicable |
| Wall-clock end-to-end drill for subprocess/daemon work | every subprocess/daemon | yes/no when applicable |
| Exercise DB-write paths against the real database, not an in-memory surrogate | every DB write | yes/no when applicable |
| Behavior-pinning tests + green existing tests for refactor PRs | every refactor PR | yes/no when applicable |

Flag missing universal principles; flag project-specific memories from the index that apply but are
uncited.

---

## Phase 3 - Plan-graph + temporal checks (R>=2)

These look ACROSS plans and over time. Phase 1 audits the plan in isolation; Phase 3 audits the plan
against its context. All git probes run against the repo root (`git rev-parse --show-toplevel`) and
the configured base (`branch.base`, default `origin/main`).

> Section numbers below (`## 8`, `## 10`, `## 15`, `## 22`) refer to the canonical section list in
> 1c. If the audited plan uses different section numbering, match by section **title**, not number.

### 3.1 - Base-SHA pin check

The plan declares it was authored against base HEAD `<X>`. Probe current base:

```bash
git log --oneline -1 <branch.base>
git rev-list --count <X>..<branch.base>
```

- Drift <=5 commits: low risk, note.
- Drift 6-20: medium, re-verify the pre-authoring verifications (§3).
- Drift >20 OR new files in the plan's `MOD` list since `<X>`: HIGH - recommend re-verify before B0.

*Principle: a plan finalized just before a parallel PR can merge into the same problem space is
high-risk; re-verify the migration slot + competing-PR list at every commit boundary.*

### 3.2 - Conflicts-with scan

```bash
# Active plans only: modified in the last 14 days, excluding shipped + backups, touching this plan's files.
find <plans.dir> -name '*.md' -mtime -14 \
  | grep -v -E 'MERGED|DELIVERED|SHIPPED|\.backup-' \
  | xargs grep -l '<file in this plan>' 2>/dev/null
```

For each plan modified within the last 14 days (no MERGED/DELIVERED/SHIPPED suffix) that touches
files in this plan's NEW/MOD list, flag the collision. Recommend an explicit
`Conflicts-with: <plan>` declaration in the §0 metadata.

### 3.3 - Open-questions queue lifecycle

Parse the plan's `## 8. Open questions to resolve before B0`. For each Q:
- Status declared? (open / resolved / blocks-B0 / blocks-Stream-b / informational)
- Owner declared?
- If `blocks-B0` and unresolved → HARD STOP: the plan cannot enter execution.

### 3.4 - Streams structure (R3 only)

If R3:
- Streams declared (a/b/g/d/e/z)? Per-stream commit count?
- Dependency arrows (Stream b depends on Stream a B4)?
- Parallel-safe streams identified?

Flat ledger at R3 → structural fail.

### 3.5 - Stop conditions (RED)

Per risk in §15:
- RED threshold named? (LOC drift %, iter# cap, CI fail pattern, wall-clock cap)
- Escalation action named? (halt / re-scope / file follow-up / operator question)

Missing thresholds → flag. Runaway iteration happens without budgets; named thresholds prevent it.

### 3.6 - Iter / wall-clock budget

R2+ plans should declare an iter budget. Probe:
- Authorized iter#N cycles: <N>
- Wall-clock cap before re-scope: <H>h
- Bias toward bounded; unbounded budgets get flagged.

### 3.7 - Plan revisions log (R3, or any plan with `.backup-*` sibling)

```bash
git -C <plans.dir> log --oneline -- <plan-file> 2>/dev/null
ls <plans.dir>/<plan-stem>.backup-*.md 2>/dev/null
```

If `<plans.dir>` is not a git repo (the `git log` probe errors), skip the git-history cross-check and
rely on the in-plan `## 22. Plan revisions` log plus any `.backup-*` sibling; a non-git plans dir is
not itself a finding.

If >1 commit OR a backup sibling exists → require `## 22. Plan revisions` entries explaining each
revision (scope change, decision flip, base-SHA refresh).

### 3.8 - Session checkpoints (R3)

For multi-day R3 plans, presence of `## 21. Session checkpoints` with dated entries per stream
completion. Without these, a resuming agent cannot tell where execution stopped.

### 3.9 - Untouched files verification

If the plan lacks an `UNTOUCHED (explicitly out of scope)` sub-section under §10 Critical files, flag.
This is the structural primitive that prevents scope drift during execution.

---

## Output format

```
=== PHASE 0: R-TIER ===
Declared: <R-tier or MISSING>
Inferred: R<N> (basis: …)
Reconciled: R<N>
Audit depth: phases <list>

=== PHASE 1: STRUCTURAL DRIFT ===
REFERENCE: <path> (tier-matched archetype | named by user | conversation prior | NONE - no archetype configured)

SECTION-PRESENCE:
- Missing required at R<N>: [...]
- Extra non-canonical: [...]
- Out-of-order: [...]

NUMBERED-SERIES GAPS:
- D-decisions: <clean | gap at D3 | …>
- B-commits: <clean | gap at B5 | …>
- R-risks / Q-questions: <…>

STREAM STRUCTURE (R3): <present with N streams + deps | FLAT - structural fail>

SUBSTANTIVE LOSSES (N): §<section> - <what was dropped>   (only when a reference is available)
SUBSTANTIVE ADDITIONS (N): §<section> - <what was added>

=== PHASE 2: PLAN-QUALITY ===

2.1 DESIGN-TESTS COMMITMENT: <table> (per-file bug-catalog commitment; file N/A at plan time)
2.2a VERIFICATION MATRIX: <present | flat checklist instead | n/a>
2.2b ACCEPTANCE vs VERIFICATION: <distinct | collapsed>
2.2c TEST LAYERS: <A present, B present, C MISSING - flag: DB writes need Layer B | …>
2.3 PACKET PRE-READ: <list>
2.4 AUTOMATE-OVER-OPERATOR: <flagged operator-only + test surface>
2.5 CODE-HEALTH BASELINE: <table per file | skipped (no tool configured)>
2.6 FAN-OUT TRIGGER: <YES + angles | NO + reason>
2.7 CODE-REVIEW RESILIENCE: <pre-empt list + dispositions | n/a no prior review>
2.8 MEMORY COVERAGE: <table; flag missing universal/applicable>

=== PHASE 3: PLAN-GRAPH + TEMPORAL (R>=2) ===

3.1 BASE-SHA DRIFT: <N commits since plan SHA; risk: low/med/HIGH>
3.2 CONFLICTS-WITH: <list of in-flight plans touching same files | none>
3.3 OPEN QUESTIONS: <count open; any blocks-B0 → HARD STOP>
3.4 STREAMS (R3): <present | missing>
3.5 STOP CONDITIONS: <present per risk | gaps: R2 R5>
3.6 ITER/WALL-CLOCK BUDGET: <iter#N=N, wall-clock=Hh | UNBOUNDED - flag>
3.7 PLAN REVISIONS LOG: <entries match git log | missing for rev at SHA X>
3.8 SESSION CHECKPOINTS (R3): <present | missing>
3.9 UNTOUCHED FILES: <present | MISSING - drift risk>

=== OVERALL VERDICT ===
Plan structural integrity: pass / fail
Plan quality audit: pass / fail / partial - [summary]
Plan-graph readiness: pass / fail / partial - [summary]
HARD STOPS: <list, or "none">
Recommended next action: [exit plan mode | revise sections X/Y | re-verify base-SHA | fire /fan-out | resolve Q-N | …]

=== SURVIVORSHIP-BIAS DISCLOSURE ===
This template is induced from the project's own plan corpus (plans.dir), weighted toward plans that
shipped. The corpus is a survivorship sample: it tells you what plans that merged happened to contain,
NOT what plans need to succeed. Sections marked OPTIONAL are observed-rare-but-load-bearing. Sections
NOT in the template may still be load-bearing for failure modes not yet encountered. A clean structural
pass means "matches the surviving corpus", not "cannot fail". Promotion criterion for adding any new
section to the template: name the specific failure mode it would have prevented.
```

---

## Self-maintenance loop (opt-in)

When env var `CHECK_DRIFT_OBSERVE=1` is set, after the audit append a one-line entry to
`observed-sections.log` in this skill's own directory:

```
<YYYY-MM-DD>\t<plan-path>\t<novel-sections-not-in-template-list>
```

A periodic review of this log surfaces sections that have accreted across N plans without the skill
knowing. The promotion criterion remains: name the failure mode the section would have caught.

---

## Anti-patterns

- **Stopping at Phase 1.** Phase 2 + Phase 3 are what catch real failure modes.
- **Running Phase 3 on R0.** Bureaucracy on hotfixes kills adoption. Tier-down.
- **Asking for a file path when one is named inline or implicit.** The reference is usually obvious.
- **Demanding a later-stage artifact at plan time.** check-drift runs before design-tests/build/prove-it, so a `.bug-catalog.md` (or any later-stage output) cannot exist yet; failing a plan for a "missing" one blocks every otherwise-converged plan. Verify the plan's per-file COMMITMENT to produce it, not the file. Still reject a bare "we'll write tests" with no per-file bug-catalog commitment.
- **Accepting operator-confirmation outcomes without challenging them.** §2.4 is the gate.
- **Auto-firing /fan-out.** §2.6 proposes; the operator confirms.
- **Treating the code-health baseline as optional when a tool is configured.** §2.5 is a gate; capture before B0.
- **Deferring code-health regressions to a follow-up PR.** "The cleanup PR" never lands.
- **Diffing against a reference when none is configured.** With a blank archetype, run section-presence only and say so.
- **Promoting every observed section to the template.** Require a named failure mode.
- **Scoring with weighted points.** Categorical signal beats a collapsed numeric.
- **Pasting the full doc back at the user.** They have it; emit deltas + flags only.
- **Reporting wording changes as substantive.** Costs trust.
- **Skipping the survivorship-bias disclosure.** Honest epistemic hygiene is non-optional.

## Machine-checkable data (REQUIRED - deterministic orchestrator gate)

The Polymath Track orchestrator (`fix_pipeline.mjs`) gates Loop #1 on JSON, never prose. After the
`=== OVERALL VERDICT ===` section, emit the verdict ALSO as the **last** `## Machine-checkable data`
fenced block in your output. It MUST agree with the prose verdict.

```json
{
  "schema": "check_drift_verdict@1",
  "r_tier": "R0|R1|R2|R3",
  "audit_depth_complete": true,
  "structural_integrity": "pass|fail",
  "plan_quality": "pass|partial|fail",
  "plan_graph": "pass|partial|fail",
  "hard_stops": [{"id": "Q2", "phase": "3.3", "detail": "what blocks B0"}],
  "open_substantive_losses": 0,
  "iteration": 1
}
```

GATE #1 (`PLAN_CONVERGED`): `audit_depth_complete===true && structural_integrity==="pass" &&
plan_quality!=="fail" && plan_graph!=="fail" && hard_stops.length===0`. A missing/invalid block is an
outage → the orchestrator HALTs (outage ≠ pass).
