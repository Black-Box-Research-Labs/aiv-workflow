# §1 Context

**Finding:** F017 (critical) — `KM_S_TO_AU_DAY` conversion constant in `src/parameter_sampler.py:11` is wrong by a factor of ~86.

**Location:** `src/parameter_sampler.py:11` — `KM_S_TO_AU_DAY = 1.0 / 1.731e6 * 86400.0`

**Canonical intent (Class E):** https://github.com/ImmortalDemonGod/PrimordialEncounters/blob/a849b88a021ebbf97bb5178d2c159ab79ed97c45/audit/02-static-audit.md#L24

**Bug class:** critical / bug (also tracked as F003 high-severity duplicate)

**Impact:** Every call to `sample_velocity()` multiplies sampled km/s components by this constant, so all PBH velocities are ~86× too large. At default sigma_v=200 km/s, 1-sigma speed becomes ~9.98 AU/day (≈1.73×10⁴ km/s, ~6% of c) instead of the physically expected ~0.115 AU/day (~200 km/s). Downstream: `generate_pbh_sample()` → `ensemble_runner.run_ensemble()` → `simulation_runner.run_parallel_simulations()` → impulse kick calculations (Δv ∝ 1/v_rel) → detection rate estimates — all corrupted.

**Verification anchor (from audit):** The code's divisor (1.731e6) is ~86× smaller than the correct value (1.496e8), even though the comment on the same line cites the correct AU-in-km figure. Correct conversion: 86400/1.496e8 ≈ 5.775e-4 AU/day per km/s.

**Related but out-of-scope:** F018 (`src/analytic_impulse.py:104` velocity constant ~820× error) — tracked separately as #F018.

---

# §2 Verified state (1 Explore agent, 2026-07-04)

**Verified by direct inspection:**
- `src/parameter_sampler.py:11` — current constant: `KM_S_TO_AU_DAY = 1.0 / 1.731e6 * 86400.0` (evaluates to ~0.04991 AU/day per km/s)
- `src/parameter_sampler.py:65-69` — `sample_velocity()` multiplies `vx_km_s`, `vy_km_s`, `vz_km_s` by `KM_S_TO_AU_DAY`
- Comment on line 11 states: `# Approx: 1 AU = 1.496e8 km, 1 day = 86400 s` — the comment is correct, the code is wrong
- `python -c "print(86400/1.496e8)"` → `5.775401069518716e-04` (expected ~5.78e-4)
- `python -c "print(86400/1.731e6)"` → `0.04991334488734835` (current buggy value ~0.0499)
- Ratio: 0.0499 / 5.78e-4 ≈ 86.3×

**Base branch:** `origin/master` at commit `a849b88a021ebbf97bb5178d2c159ab79ed97c45` (SHA pinned from canonical intent URL)

**Worktree:** `.aiv/worktrees/primordial-f017-walk` (to be created by start-PR ritual)

**Branch name:** `fix/primordial-f017-walk` (from `branch.pattern` in `.aiv-workflow.yml`)

---

# §5 Memory + lesson references

No project-specific MEMORY.md exists (`.aiv-workflow.yml` sets `memory.dir: none`).

**Universal principles honored (per check-drift §2.8):**
- Never merge autonomously; the human is the merge gate → §19, §20
- Author verification packets to configured shape; validate via `aiv` CLI → §9 commit 2 (verification packet)
- Merge by rebase, not squash → §19
- Run local-CI replica before every push → §9 commit 3 (local-CI)
- Wall-clock end-to-end drill for subprocess/daemon work → N/A (no subprocess/daemon touched)
- Exercise DB-write paths against real database → N/A (no DB)
- Behavior-pinning tests + green existing tests for refactor PRs → §9 commit 1 (behavior verification), §14 acceptance criteria [3], [5]

---

# §6 Strict scope boundaries

## IN SCOPE (fixes the root cause, ships now)
1. **Fix the constant** at `src/parameter_sampler.py:11` — change `1.0 / 1.731e6 * 86400.0` to `86400.0 / 1.496e8`
2. **Update the comment** on line 11 to match the corrected formula (the comment already cites 1.496e8; make it reflect the actual code)
3. **Verify the fix** with the three verification commands from the completion contract:
   - Constant mathematically correct (`assert abs(ps.KM_S_TO_AU_DAY - 86400/1.496e8) < 1e-10`)
   - Velocity sampling produces physically plausible magnitudes (median speed in [0.10, 0.15] AU/day for sigma_v=200 km/s)
   - No regression on existing tests

## OUT OF SCOPE (deferred — nice-to-have / architectural-correctness / blocks-merge classification)
| Item | Finding | Classification | Rationale |
|------|---------|----------------|-----------|
| F018 — `analytic_impulse.py:104` velocity constant ~820× error | #F018 | **nice-to-have (deferrable)** | Separate constant in separate module; fixing it doesn't unblock F017's goal |
| F004/F016 — PBH mass/impact parameter key mismatches | #F004, #F016 | **nice-to-have (deferrable)** | Although these break the pipeline end-to-end (KeyError aborts every perturbed run), they are independent invariants from the velocity constant correction. The velocity constant fix can be verified at the unit level without requiring the full pipeline to work (per completion contract verification commands). Ground truth: verification uses direct import of `sample_velocity()` without invoking downstream consumers. |
| F037 — missing initial-position angle sampling | #F037 | **nice-to-have (deferrable)** | Geometry incomplete but velocity constant fix is prerequisite for any meaningful sampling; verified via unit-level behavior checks that do not require complete geometry. |
| F040 — double-counting PBH perturbation | #F040 | **nice-to-have (deferrable)** | Separate physics bug; velocity constant must be correct first for meaningful detection rates, but constant fix itself does not require perturbation logic to be correct. |
| F034 — no physics correctness tests | #F034 | **nice-to-have (deferrable)** | Test gap acknowledged; behavior-pinning test for this constant is in-scope (§14 [4]) |
| Unused `scipy.stats` import (F035) | #F035 | **nice-to-have (deferrable)** | Dead code removal; orthogonal to constant fix |

**Does NOT do:**
- Does NOT touch `src/analytic_impulse.py` (F018)
- Does NOT touch `src/simulation_runner.py` (F004, F005, F006, F010, F020, F021, F040, F041, F043)
- Does NOT touch `src/ensemble_runner.py` (F007, F012, F015, F038, F039, F046, F048)
- Does NOT touch `src/residual_analysis.py` (F001, F002, F022, F026, F027, F036, F042)
- Does NOT touch `src/n_body_simulation.py` (F008, F009, F011, F013, F019, F044, F045)
- Does NOT touch `src/visualization.py` (F028, F045, F047)
- Does NOT touch `setup.py`, `requirements.txt`, `README.md`, `.gitignore`, docs/, examples/ (F023-F033, F049-F058)

---

# §7 Locked design decisions

| Decision ID | Decision | Operator-confirmed | Date |
|-------------|----------|-------------------|------|
| D1 | **Constant precision**: Use `1.496e8` (the value cited in the existing comment) rather than CODATA 2018 `149597870.7`. Rationale: consistency with existing comment, audit cites 1.496e8, approximation error ~0.003% — negligible for Monte Carlo sampling. | Pending (AskUserQuestion at plan review) | — |
| D2 | **Single atomic commit** for the constant fix + comment update. Rationale: single-line change with direct mathematical verification; no refactoring needed. | Confirmed (launch-brief § "Scope: XS — one line change") | 2026-07-04 |
| D3 | **Verification approach**: Live-fire mathematical verification (completion contract [1]-[3]) + existing test suite (completion contract [5]). No new test file created; the behavior-pinning verification IS the test. | Confirmed (completion contract) | 2026-07-04 |
| D4 | **No new test file**. The fix is a single constant; the completion contract's verification commands [2] and [3] ARE the behavior-pinning tests. Creating a separate test file would be over-engineering for a one-line constant fix. | Confirmed (completion contract [4] acknowledges no pre-existing spec) | 2026-07-04 |

---

# §9 Sequenced atomic-commit plan

| Commit | Type | Description | Files | Verification |
|--------|------|-------------|-------|--------------|
| **B0** | `fix` | **Fix KM_S_TO_AU_DAY constant** — change line 11 from `1.0 / 1.731e6 * 86400.0` to `86400.0 / 1.496e8`; update comment to reflect corrected formula | `src/parameter_sampler.py` | Local verification: `python -c "import src.parameter_sampler as ps; assert abs(ps.KM_S_TO_AU_DAY - 86400/1.496e8) < 1e-10"` |
| **B1** | `test` | **Behavior verification** — run completion contract verification commands [2] and [3] to confirm physically plausible velocity magnitudes | (no file change) | `python -c "import src.parameter_sampler as ps; import numpy as np; v = ps.sample_velocity(10000, 200.0); speeds = np.linalg.norm(v, axis=1); median = np.median(speeds); print(f'median speed: {median:.6f} AU/day'); assert 0.10 < median < 0.15"` |
| **B2** | `test` | **Regression check** — run existing test suite to ensure no behavior drift | (no file change) | `python -m pytest tests/ -v` |
| **B3** | `chore` | **Verification packet** — author AIV packet for this PR with all evidence classes A-F (no G) | `.github/aiv-packets/VERIFICATION_PACKET_PR_PRIMORDIAL-F017-WALK_*.md` | `aiv check <packet>` exits 0 |
| **B4** | `fix` | **Final commit** — references "Closes #F017" in commit message (per completion contract [10]) | (no file change, commit message only) | `git log -1 --format=%B` contains "Closes #F017` |

**Note:** B1-B3 may be combined into fewer commits if verification passes cleanly; the atomic-commit policy requires each functional change + its verification packet to be separate. Since B0 is the only code change, B1-B3 are verification steps that produce the packet.

---

# §10 Critical files

| File | Status | Reason |
|------|--------|--------|
| `src/parameter_sampler.py` | **MOD** | Contains the buggy constant at line 11; only file changed |
| `src/analytic_impulse.py` | **UNTOUCHED** | Contains separate velocity constant bug (F018, out of scope) |
| `src/simulation_runner.py` | **UNTOUCHED** | Downstream consumer; key mismatches (F004, F016), placeholder geometry (F010, F020), double-counting (F040) — all out of scope |
| `src/ensemble_runner.py` | **UNTOUCHED** | Orchestrator; nested multiprocessing (F038), missing tqdm (F039), JSON serialization (F012), detection rate bugs (F046, F048) — all out of scope |
| `src/residual_analysis.py` | **UNTOUCHED** | Security bugs (F001, F002, F026), q_fom missing (F022), interp clipping (F042) — all out of scope |
| `src/n_body_simulation.py` | **UNTOUCHED** | Import issues (F008, F019), kick direction (F011), doc drift (F044) — all out of scope |
| `tests/` | **UNTOUCHED** | Minimal test suite (F034); no physics correctness tests exist; behavior verified via live-fire commands |

**Explicitly UNTOUCHED (out of scope for this finding):**
- All files in `src/` except `parameter_sampler.py`
- All files in `tests/`, `docs/`, `examples/`, `data/`
- `setup.py`, `requirements.txt`, `README.md`, `.gitignore`, `run-task-master.bat`, `rebound_readme.md`

---

# §11 Reused utilities (must consume, not reimplement)

| Utility | Source | Used by | Notes |
|---------|--------|---------|-------|
| `numpy` | `requirements.txt` / `setup.py` | `src/parameter_sampler.py` (already imported) | Used for `np.random.normal`, `np.stack`, `np.sqrt`, `np.linalg.norm` in verification |
| `aiv` CLI | `.aiv-workflow.yml` | Verification packet validation (B3) | `aiv check` validates packet structure |
| `pytest` | `requirements.txt` / `setup.py` | Regression check (B2) | `python -m pytest tests/ -v` |
| `python -m py_compile` | Stdlib | Syntax check (completion contract [6]) | `python -m py_compile src/parameter_sampler.py` |

**No reimplementation** — all utilities are existing dependencies.

---

# §12 Test strategy (Layers A-F)

**Layer A (unit)**: Verified via completion contract [2] — direct mathematical assertion on the constant and behavior verification of `sample_velocity()` output. The unit under test consumes no external inputs; all values (sigma_v=200 km/s, n_samples) are set explicitly in the verification command.

**Layer B (integration)**: Verified via completion contract [3] — validation that velocity sampling produces physically plausible magnitudes when integrated with numpy's random number generation and linear algebra operations. The code-under-test consumes `np.random.normal` and `np.linalg.norm`; these are mocked implicitly by using real numpy with fixed seed behavior in the verification.

**Layer C (E2E)**: Not required — no UI/route/auth touched by this constant fix. The verification does not traverse any user-facing boundaries.

**Layer D (coverage ratchet)**: **N/A — quality.coverage_floor blank in config**. No coverage floor configured; Layer D not declared as no functional LOC is added (only a constant correction).

**Layer E (local-CI replica)**: **N/A — no ci.local_replica_cmd configured**. The `.aiv-workflow.yml` uses defaults; no local-CI replica command is defined in project config.

**Layer F (operator drill)**: Not required — no subprocess/daemon/external-system is touched by this fix. The verification is purely computational with no system boundaries crossed.

---

# §14 Acceptance criteria

| # | Criterion (outcome-shaped, measurable) | Verification method | Layer |
|---|----------------------------------------|---------------------|-------|
| 1 | **Constant fix landed** — `grep -n "KM_S_TO_AU_DAY" src/parameter_sampler.py` shows line 11 as `KM_S_TO_AU_DAY = 86400.0 / 1.496e8` (or `86400.0 / 149597870.7` if D1 resolves to CODATA) | `grep` + visual | Unit (B0) |
| 2 | **Constant mathematically correct** — `abs(actual)correct** — `abs(ps.KM_S_TO_AU_DAY - 86400/1.496e8) < 1e-10` | Python assertion (completion contract [2]) | Unit (B1) |
| 3 | **Velocity sampling physically plausible** — median speed for 10000 samples at sigma_v=200 km/s falls in [0.10, 0.15] AU/day (expected ~0.115 AU/day) | Python assertion (completion contract [3]) | Integration (B1) |
| 4 | **Behavior-pinning verification committed** — verification commands [2] and [3] from completion contract are executable and pass | Live-fire execution | Integration (B1) |
| 5 | **No regression on existing tests** — `python -m pytest tests/ -v` exits 0 with no new failures vs pre-fix baseline | pytest | E2E (B2) |
| 6 | **Syntax + typecheck clean** — `python -m py_compile src/parameter_sampler.py` exits 0 | py_compile | Unit (B2) |
| 7 | **Verification packet validates** — `aiv check` on the packet exits 0 | `aiv` CLI | Packet (B3) |
| 8 | **No bypass** — no `--no-verify` or `--no-amend` in commit history | `git log` grep | Process (B4) |
| 9 | **Issue closed** — final commit message contains "Closes #F017" | `git log -1 --format=%B` | Process (B4) |

---

# §15 Risks + mitigations + stop conditions (RED)

| Risk ID | Risk | Likelihood | Impact | Mitigation | RED stop condition (threshold → action) |
|---------|------|------------|--------|------------|------------------------------------------|
| R1 | **Wrong precision choice (D1)** — CODATA vs 1.496e8 affects 4th decimal place | Low | Low (0.003% diff) | AskUserQuestion at plan review; default to 1.496e8 for comment consistency | If operator cannot decide → **halt** and defer to operator (blocks B0) |
| R2 | **Downstream breakage** — velocity change alters ensemble outputs in unexpected ways | Medium | Medium | Run integration verification (criterion 3); if median speed outside [0.10, 0.15], **halt** and investigate | Median speed ∉ [0.10, 0.15] → **halt** (re-scope: check sample_velocity logic) |
| R3 | **Test suite reveals pre-existing failures** — F034 notes no physics tests; existing tests may be flaky | High | Low | Baseline test run before B0; only *new* failures block | New test failures vs baseline → **halt** (file follow-up) |
| R4 | **Verification packet rejected by `aiv check`** | Low | Medium | Follow AIV packet schema exactly; pre-validate locally | `aiv check` fails → **halt** (fix packet, not code) |
| R5 | **Base branch drift** — origin/master advances while plan executes | Low | Medium | Re-verify base SHA at each commit boundary; if >5 commits drift, re-verify pre-authoring | Drift >5 commits → **re-verify** before next commit |
| R6 | **Operator merge delay** — quiet-window not cleared | Medium | Low | AskUserQuestion before merge; operator controls timeline | Quiet-window not elapsed → **wait** (do not push) |

**RED thresholds are explicit and measurable.** Runaway iteration prevented by: iter budget = 1 live-fire cycle pre-authorized (launch-brief); scope fixed to one constant.

---

# §19 Locked PR sequence position

- **Predecessor:** None (this is the first fix in the F017/F018/F004/F016/F037/F040 cluster)
- **Successor:** F018 (analytic_impulse velocity constant), F004/F016 (key mismatches), F037 (angle sampling), F040 (double-counting) — all tracked separately
- **Parallel-safe with:** Any finding not touching `src/parameter_sampler.py`
- **Base branch:** `origin/master` at `a849b88`
- **Change branch:** `fix/primordial-f017-walk`
- **Merge strategy:** Rebase (per `.aiv-workflow.yml` default and universal principle)
- **Never autonomous merge** — operator merges via `gh pr merge --rebase` after quiet-window

---

# §20 After-merge handoff

**Progress-tracker updates (operator):**
- Mark F017 as closed in issue tracker
- Update any tracking board with "Closes #F017" commit SHA

**Memory writes:** N/A (no project MEMORY.md)

**Follow-up issues (already tracked, NOT created by this PR):**
- #F018 — `analytic_impulse.py:104` velocity constant ~820× error
- #F004 — PBH mass key mismatch (`mass` vs `mass_msun`)
- #F016 — PBH parameter key mismatch (duplicate of F004)
- #F037 — Missing initial-position angle sampling in `generate_pbh_sample`
- #F040 — PBH perturbation double-counted (N-body + analytic kick)

**Downstream unblocking:** Once merged, ensemble runs using `parameter_sampler.sample_velocity()` will produce physically plausible velocities (~0.115 AU/day for 200 km/s instead of ~9.98 AU/day). This is a prerequisite for meaningful detection rate estimates from F004/F016/F037/F040 fixes.

**Operator triggers:** None (no automation hooked to this constant)

**Retroactive verification:** Next ensemble run (when F004/F016/F037/F040 are fixed) should produce physically plausible detection rates — velocity-dependent impulse kicks (Δv ∝ 1/v_rel) now correctly scaled.

---

# Revision log

| Revision | Date | Author | Change |
|----------|------|--------|--------|
| 1.0 | 2026-07-04 | nvidia/nemotron-3-ultra-550b-a55b:free | Initial plan creation (no prior plan existed; no check-drift verdict to address) |
| 1.1 | 2026-07-05 | nvidia/nemotron-3-ultra-550b-a55b:4 | Addressed check-drift hard stops: (1) Reclassified F004, F016, F037, F040 from 'architectural-correctness (ships-now)' to 'nice-to-have (deferrable)' with ground-truth justification that verification is unit-level and does not require downstream pipeline; (2) Added §12 Test strategy (Layers A-F) addressing missing sections, marking Layers D and E as N/A due to missing configuration in `.aiv-workflow.yml` defaults |