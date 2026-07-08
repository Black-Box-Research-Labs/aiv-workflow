# PR-primordial-f017-walk - Fix KM_S_TO_AU_DAY conversion constant (factor ~86 error)

## Goal

Close #F017 - Fix the KM_S_TO_AU_DAY conversion constant in `src/parameter_sampler.py:11` which is wrong by a factor of ~86, making every sampled PBH velocity ~86× too large and invalidating all Monte Carlo detection rate estimates.

The constant `KM_S_TO_AU_DAY = 1.0 / 1.731e6 * 86400.0` evaluates to ≈0.0499 AU/day per km/s. The correct conversion using 1 AU = 1.496e8 km, 1 day = 86400 s is 86400/1.496e8 ≈ 5.775e-4 AU/day per km/s. The code's divisor (1.731e6) is ~86× smaller than the correct value (1.496e8), even though the comment on the same line cites the correct AU-in-km figure.

## High-level facts (verify each yourself)

- **File anchor**: `src/parameter_sampler.py:11` — `KM_S_TO_AU_DAY = 1.0 / 1.731e6 * 86400.0`
- **Bug class**: critical / bug (F017 in audit/02-static-audit.md, also F003 high-severity duplicate)
- **Impact**: Every call to `sample_velocity()` (lines 58-70) multiplies sampled km/s components by this constant, so all PBH velocities are ~86× too large. At default sigma_v=200 km/s, 1-sigma speed becomes ~9.98 AU/day (≈1.73×10⁴ km/s, ~6% of c) instead of the physically expected ~0.115 AU/day (~200 km/s).
- **Downstream consumers**: `generate_pbh_sample()` → `ensemble_runner.run_ensemble()` → `simulation_runner.run_parallel_simulations()` → impulse kick calculations (Δv ∝ 1/v_rel) → detection rate estimates. All corrupted.
- **Verification anchor**: The audit's falsifier note at F017 confirms the math: 86400/1.731e6 ≈ 0.0499 vs correct 86400/1.496e8 ≈ 5.78e-4.
- **Related constant**: `src/analytic_impulse.py:104` has a separate but related velocity constant error (F018, ~820×) — out of scope for this PR, tracked separately.

## You decide (at plan-mode + via AskUserQuestion)

- **Constant precision**: Use the exact CODATA 2018 AU value (149597870.7 km) or the 1.496e8 approximation used in the existing comment? The audit cites 1.496e8; the comment on line 11 says "1 AU = 1.496e8 km". Recommend using 1.496e8 for consistency with the comment unless the project has a constants module.
- **Verification command**: Which live-fire command proves the constant is correct? Suggested: `python -c "import src.parameter_sampler as ps; print(ps.KM_S_TO_AU_DAY); print(86400/1.496e8); assert abs(ps.KM_S_TO_AU_DAY - 86400/1.496e8) < 1e-10"`

## Worktree + branch

The start-PR ritual creates the worktree at `.aiv/worktrees/primordial-f017-walk` (from `branch.worktree_pattern`) on `feat/primordial-pr-primordial-f017-walk-fix-km-s-to-au-day-constant` (from `branch.pattern`) off `origin/main` (`branch.base`, default).

## Gates (binary)

- **start-PR ritual mandatory**
- **Constant fix landed** - `grep -n "KM_S_TO_AU_DAY" src/parameter_sampler.py` shows corrected value
- **Unit verification passes** - `python -c "import src.parameter_sampler as ps; assert abs(ps.KM_S_TO_AU_DAY - 86400/1.496e8) < 1e-10"`
- **No regression on velocity sampling** - `python -c "import src.parameter_sampler as ps; v = ps.sample_velocity(1000, 200.0); speeds = (v**2).sum(axis=1)**0.5; print(f'median speed AU/day: {__import__(\"numpy\").median(speeds):.6f}'); assert 0.1 < __import__(\"numpy\").median(speeds) < 0.2"`
- **Atomic-commit policy honored; verification packet passes `aiv check`; agent authorship expected (no "no AI author" gate); no `--no-verify`/`--amend` outside authorized exception**
- **Lint exit 0** (already green; maintain)
- **Typecheck exit 0** (no typed language; drop)
- **Local-CI replica green before push** (`ci.local_replica_cmd`)
- **Review quiet-window cleared pre-merge**
- **Never autonomous merge** - operator merges via project's strategy (`merge.strategy`, default `rebase`)
- **Issue #F017 closure** - final commit references "Closes #F017"

## Iter budget

**1 live-fire iter cycle pre-authorized.** The fix is a single constant change with direct mathematical verification. Surface +1 via AskUserQuestion if scope grows.

## When to AskUserQuestion

- Before merge - review quiet-window check
- If the constant precision decision (CODATA vs 1.496e8) needs operator input
- If any test reveals unexpected downstream breakage

## Risk tier + scope estimate

- **Risk: R1** (single constant fix, mathematically verifiable, critical severity but isolated scope)
- **Scope: XS** - one line change in `src/parameter_sampler.py:11` + verification (size by scope, NOT a time estimate)

## Out-of-scope

- F018 (analytic_impulse.py:104 velocity constant ~820× error) -> tracked separately as #F018
- F004/F016 (PBH mass/impact parameter key mismatches) -> tracked separately as #F004, #F016
- F037 (missing initial-position angle sampling) -> tracked separately as #F037
- F040 (double-counting PBH perturbation) -> tracked separately as #F040
- Any other findings from audit/02-static-audit.md

## Reading order before start-PR

1. This brief + completion contract
2. `src/parameter_sampler.py` (full file, lines 1-162)
3. `audit/02-static-audit.md` lines for F017 and F003 (the canonical intent)
4. Project config: `.aiv-workflow.yml` (absent, using skill defaults)
5. Project lessons: none found (no MEMORY.md)

Now run the start-PR ritual.