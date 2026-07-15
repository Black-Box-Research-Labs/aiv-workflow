# FINDING PR-GAMMA-29 — Writer quality-score parity (D4) has no independent cross-validation

| Field | Value |
|---|---|
| ID | PR-GAMMA-29 |
| Severity | medium |
| Status | unverified (drive reproduces "behavior absent" at base) |
| Location | `scripts/verify-quality-score-parity.sh` (ABSENT) + `engine/commands/cycle-test-runs-writer.ts:106` (`computeQualityScore`) + `scripts/compute-quality-score.ts` (canonical TS CLI) |
| Class / Category | **feature-absent** |
| Closes | #301 (writer-plumbing D4; D1-D3 landed in γ.17-φ #288; D5 diagnostic is H2) |

## Toolchain (READ FIRST — Node/TypeScript/Astro repo, NOT Python)

No Python venv. Provision `npm ci`; tests are **vitest** (`npx vitest run`), specs `*.spec.ts`; typecheck `npx tsc --noEmit`. Ignore any pytest/`.venv` hints from the generic stage prompts. The canonical formula CLI is invoked as a TS script (see `scripts/compute-quality-score.ts` shebang/`tsx`/`node` usage — match how `cycle-test-runs-writer.spec.ts:28` spawns `CLI_PATH`).

## Required behavior that is ABSENT (D4)

The §13.5 quality-score formula lives **only** in TypeScript (`computeQualityScore` in the writer;
`scripts/compute-quality-score.ts` is a thin CLI that *imports* it — so it is NOT an independent check).
There is **no committed independent cross-validation** of that formula. This is not hypothetical: the writer
spec (`cycle-test-runs-writer.spec.ts:58-76`) records a real **bash↔TS divergence** — "Agent's bash δ-6
reported 7.92 for these inputs; the TS formula computes 8.92" (a **1.0** discrepancy that shipped undetected).
γ.17-φ (#288) left this as follow-up **#iii**: a `verify-quality-score-parity.sh` cross-validation pin.

## The oracle (approach-agnostic, DB-FREE, machine-checkable, runnable in the worktree)

`goal_condition`:

```
bash scripts/verify-quality-score-parity.sh \
  && npx tsc --noEmit \
  && npx vitest run engine/commands/cycle-test-runs-writer.spec.ts
```

exits 0 when — and only when — `scripts/verify-quality-score-parity.sh`:

1. **Exists** and is executable.
2. Computes `quality_score` **independently in bash** per the §13.5 weights (30% wallclock ≤30min→1.0/≥60min→0,
   25% findings 0→0/≥6→1.0, narrative, cis, 10% interventions 0→1.0/≥5→0 — mirror the weights in
   `cycle-test-runs-writer.ts` `computeQualityScore`), on a **fixture set of synthetic inputs** (NOT the live DB).
3. Invokes the **canonical TS CLI** (`scripts/compute-quality-score.ts`) on the **same** inputs.
4. Asserts `|bash − TS| ≤ 0.5` for every fixture; **exit 0** on parity, non-zero (with the diverging row) otherwise.

Plus the writer spec (`engine/commands/cycle-test-runs-writer.spec.ts`, extended) asserts the D-item
invariants that already exist in code (D1 `aqs_shadow` populated by `computeAqsShadow`; D2 `wallclockSec`
derivation; D3 `aqsInput.findings` real-data threading) so a regression re-introducing the all-zero-stub bug
is caught. The SEAM holds: at `origin/main` the script is absent → the parity check fails (RED = feature
absent); at HEAD it exists + passes (GREEN).

> **Bounded-correctness / H2 boundary.** This oracle validates the *formula parity* + the writer's
> *unit-level* population logic. The contract's **live-fire** items — D1 `aqs_shadow` ≥4 non-zero dims, D2
> `wallclock_sec` within ±60s of the real chain, D3 `aqsInput.findings` real data, D6 writer-fires-per-verdict
> — are `psql "$DATABASE_URL_DIRECT_pr_gamma_live_test"` probes after a ~24-min chain: **irreducible H2**
> (they need the live DB + a real audit run). The drive closes D4 + the spec pins; the operator runs iter#29
> live-fire + the D5 diagnostic.

## D5 (dedup) — diagnostic is H2 (needs the live DB)

Code trace (the half I can do): the writer is enqueued by `watch-dispatchers-validate-draft.ts:148` on
**both** the pass and fail branches; a multi-attempt chain re-runs validate-draft, re-enqueuing the writer.
Migration 030 (`cycle_test_runs_target_run_uniq` on `(target_id, run_id)`) would dedup duplicate writes.
**Whether iter#20's 3× firing was distinct attempts or true duplicates needs**
`SELECT count(*), attempt_number FROM cycle_test_runs WHERE notes LIKE '%<runId>%' GROUP BY attempt_number`
**against the live DB — operator-only.** So D5's fix path (dedup at the dispatcher tail vs document
multi-attempt-is-correct) is deferred to the operator's verdict; **do NOT implement a dedup change in this
drive** without that verdict (it could drop legitimate multi-attempt rows). Pin D5 as an issue if unresolved.

## Do-NOT-touch scope (answer key)

- Do NOT make the bash formula a 1:1 shell-out to the TS (that defeats the independent cross-check); implement
  the weights in bash directly so the two derivations are genuinely independent.
- Do NOT weaken the parity threshold above 0.5 or delete fixtures to force exit 0.
- Do NOT alter the D1-D3 production code (it already works); the spec only *pins* it.
- Do NOT implement D5 dedup without the operator's live-DB verdict.

## Divergence from the 2026-05-22 brief (verified against `origin/main`)

- Brief's target `watch-dispatchers-cycle-test-runs-writer.ts` does not exist; the file is
  `engine/commands/cycle-test-runs-writer.ts` (renamed/refactored).
- D1/D2/D3 machinery **already landed** in γ.17-φ (#288, merged 2026-05-22): `extractMetricsFromDal` derives
  real metrics, `computeAqsShadow` populates `aqs_shadow`, wallclock is derived + unit-tested. The brief's
  "all-zero stub" evidence is **pre-#288**. This finding targets the genuinely-open D4 + a consolidating spec.

## Out-of-scope

`operator_interventions` table (E2/γ.30 — D5 hardcodes `interventions:0`); anchor-emit (γ.26); multi-tool
synth (γ.25); dispatcher propagation (γ.27); schema completeness (γ.30).
