# Dispatch playbook — pre-flight BEFORE picking a finding and authoring an agent prompt

> **⚠ CURRENT STATE (2026-07-06, the 1B/ceremony campaign — READ FIRST):** this document predates ~35
> structural fixes (#140–#174). Before acting, read `docs/design/TRACE_LOOP.md` (the operating method +
> goal template + bake harness).
> Key operational deltas: `FIX_HARNESS_CEREMONY` (build|all|unset — supervisor defaults to `build`);
> `drive_supervisor.sh` now sets the per-turn tracer + handles exit 4 (deterministic fail) and 5 (REFUTED =
> success, never re-drive); `--seam-check` CLI verifies any parked PR's RED-at-base/GREEN-at-HEAD seam.

> Self-instructions for the dispatcher (me). Read this **before** selecting a finding or writing a dispatch
> prompt. It exists because two failures happened that shouldn't have — both were "right there" in artifacts I
> hadn't read yet: (a) I declared a repo's canonical audit "missing" after checking the **working tree of a stale
> dev branch** instead of its default branch; (b) I picked a finding for a novel "external-oracle" stress test
> without reading its ratified `goal_condition`, which was a **weak self-authored-test oracle** that would have
> made the drive prove nothing. Reading the artifacts up front prevents both.

## 0. The two-source model — read BOTH, trust neither alone
- **The target repo's own audit** is the Class-E intent. It lives on the repo's **DEFAULT branch** (often `main`,
  sometimes `master`) at `audit/02-static-audit.md` (+ `.json`, + `audit/04-goal.md` long-term goals + `05-plan`).
  Read it via `git show origin/<default-branch>:audit/02-static-audit.md` — **NOT** `ls audit/` in the working
  tree (the checked-out branch may be a stale snapshot with no `audit/` dir). Confirm the default branch first:
  `git remote show origin | grep 'HEAD branch'`.
- **The openclaw `queue.jsonl`** is the ratified cross-repo dispatch layer: per-finding rows carrying
  `goal_condition` / `status` / `plan_id` / `pr_url`. The H1 finding + its goal come from here.
- **Reconcile:** the queue row's `finding_id` must exist in the target's audit; the audit gives the intent the
  packet pins to, the queue gives what the pipeline gates on. (A repo can be in both — e.g. biosystems has 95
  queue rows AND its own `audit/` on `main`.)

## 1. ORACLE-STRENGTH TRIAGE — the non-negotiable check
Before dispatch, **read the row's `goal_condition` and classify its oracle:**
- **WEAK (self-authored)** — "add a test and verify it passes", "tests pass", "function returns X" where the
  author picks X. The agent **defines AND satisfies** success → verification theater one level down (#34 at the
  oracle level). A cheap distilled driver will exploit this; the corpus label is a tautology.
- **STRONG (external)** — a metamorphic property; agreement with a published reference/formula; an invariant that
  must hold (conservation, monotonicity, sign, dimensional); cross-artifact consistency + arithmetic-from-source;
  or behavioral RED→GREEN against a **pre-existing real failing** test.
- **RULE:** if the finding has *any* external truth (scientific formula, spec, invariant, cross-file consistency)
  but the `goal_condition` only says "add a test that passes," **REWRITE the goal_condition to encode the external
  property/reference BEFORE dispatch.** Never drive a weak oracle when a strong one exists — it proves little and
  poisons the training corpus with tautological labels. The `goal_condition` you pass **is** the oracle.
- **By finding class:** `bug` → is there an invariant the bug violates? `security` → a property ("no RCE for any
  input"), not one example payload. `physics/scientific` → published formula + metamorphic identity. `doc_drift`/
  `reproducibility` → recompute the canonical value from source data; assert cross-artifact agreement (arithmetic).
  `feature` → reference values from the spec. `perf` → a complexity/throughput bound, measured.

## 2. Freshness (#35)
Verify the finding isn't already driven: check the queue row's `pr_url`/`status` **and** the target repo's
open/merged PRs (via `GIT_TOKEN` directly if the repo is outside MCP scope). Don't dispatch a finding with a PR.

## 3. Default branch + kit currency
- Thread `baseBranch` = the target's real default (master-compat is in canonical; a `master`/non-main repo HALTs
  on a stale kit).
- The agent must `git pull` the canonical kit before driving so it has the current fixes (#14 master-compat,
  #52 venv, #57 back-half capture, #58 rebase-push, #61 drive_id). A pilot on a stale kit degrades or HALTs.

## 4. Capture + safety
- `FIX_TRAINDATA_DIR` → a clone of your own training-data repo; confirm the kit has back-half capture (#57) and
  rebase-before-push (#58).
- **PHI/secrets:** if the repo holds personal data (e.g. biosystems HR/HRV/GPS, `data/subjective.csv`), the
  prompt MUST instruct: keep PHI/secrets out of the AIV packet **and** the corpus — behavioral evidence may *run*
  on real data, but report only derived/aggregate values, never raw PHI rows or coordinates.

## 5. What to READ before authoring (≈30 s, saves a wasted drive)
queue row → audit entry (`02-static-audit.md` + `.json`) → **triage the `goal_condition`** → the source file at
the cited location + its existing tests → `audit/04-goal.md` success signals (a long-term goal may already state
the external oracle — reuse it).

## 6. Author the prompt — use `DISPATCH_TEMPLATE.md`
Don't hand-roll it (that's how the first five prompts drifted). Fill the slots in **`DISPATCH_TEMPLATE.md`**: it
references `AGENT_PREPROMPT.md` for the invariant 80% (setup/commands/HALT/flywheel/invariants) and carries only
the per-drive variables + the **oracle** (with its class) + the per-repo hazards. Restate that **success = the
external oracle**, not "a test passes." Currency is self-validating (selftest 0-failed), never a pinned SHA.
