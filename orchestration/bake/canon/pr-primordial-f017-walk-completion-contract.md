===== PR-PRIMORDIAL-F017-WALK COMPLETION CONTRACT - Fix KM_S_TO_AU_DAY conversion constant (factor ~86 error) =====

GOAL: Close #F017 - Fix the KM_S_TO_AU_DAY conversion constant in `src/parameter_sampler.py:11` which is wrong by a factor of ~86, making every sampled PBH velocity ~86× too large and invalidating all Monte Carlo detection rate estimates. INVESTIGATION-FIRST: N/A (straightforward constant fix).

VERIFY (binary green/red):

[1] CONSTANT FIX LANDED - KM_S_TO_AU_DAY CORRECTED
  cmd: grep -n "KM_S_TO_AU_DAY" src/parameter_sampler.py
  pass: line 11 shows `KM_S_TO_AU_DAY = 86400.0 / 1.496e8` (or `86400.0 / 149597870.7` if CODATA precision chosen); value evaluates to ~5.775e-4

[2] UNIT VERIFICATION PASSES - CONSTANT MATHEMATICALLY CORRECT
  cmd: python -c "import src.parameter_sampler as ps; expected = 86400.0 / 1.496e8; actual = ps.KM_S_TO_AU_DAY; print(f'expected={expected:.10e}, actual={actual:.10e}, diff={abs(actual-expected):.2e}'); assert abs(actual - expected) < 1e-10"
  pass: exit 0; printed diff < 1e-10

[3] NO REGRESSION ON VELOCITY SAMPLING - PHYSICAL MAGNITUDES RESTORED
  cmd: python -c "import src.parameter_sampler as ps; import numpy as np; v = ps.sample_velocity(10000, 200.0); speeds_au_day = np.linalg.norm(v, axis=1); median_speed = np.median(speeds_au_day); print(f'median speed: {median_speed:.6f} AU/day'); assert 0.10 < median_speed < 0.15, f'median {median_speed} outside expected [0.10, 0.15]'"
  pass: exit 0; median speed in [0.10, 0.15] AU/day (physically ~0.115 AU/day for 200 km/s 1-sigma)

[4] BEHAVIOR-PINNING TESTS LANDED BEFORE REFACTOR
  cmd: git log --reverse --format='%H %s' -- src/parameter_sampler.py | head -5
  pass: verification commit (this PR) shows constant fix; no pre-existing spec for this constant existed (gap acknowledged in audit F034 - no physics correctness tests)

[5] EXISTING TESTS REMAIN GREEN (no behavior drift)
  cmd: python -m pytest tests/ -v 2>&1 | tail -20
  pass: exit 0; no new failures vs pre-fix baseline (test suite is minimal per F034)

[6] TYPECHECK + LOCAL-CI
  cmd: python -m py_compile src/parameter_sampler.py && python -m pytest tests/ -x -q 2>&1
  pass: exit 0

[7] PACKET VALIDATES
  cmd: aiv check .github/aiv-packets/VERIFICATION_PACKET_PR_PRIMORDIAL-F017-WALK_*.md
  pass: aiv check exits 0 for every packet

[8] NO BYPASS
  cmd: git log origin/main..HEAD --pretty=format:'%B' | grep -cE '--no-verify|--amend'
  pass: 0 matches

[9] REVIEW QUIET-WINDOW + CONVERGENCE
  cmd: gh pr view <N> --json reviews --jq '.reviews[-1] | (.body[:120] + " | submittedAt=" + .submittedAt)'
  pass: latest automated-review body shows zero actionable comments AND the quiet window has elapsed since the last review

[10] ISSUE CLOSED
  cmd: gh pr view <N> --json body --jq '.body' | grep -E "Closes #F017"
  pass: PR body references "Closes #F017"

PRE-MERGE:
  - operator AskUserQuestion -> yes (contract satisfied; constant fix verified; velocity sampling physically correct)
  - operator merges via rebase

POST-MERGE:
  - **Bookkeeping**:
    - issue #F017 closed via "Closes #F017" in the final commit
  - **Downstream unblocking**: F018 (analytic_impulse velocity constant), F004/F016 (key mismatches), F037 (missing angle sampling), F040 (double-counting) remain as separate tracked issues
  - **Operator triggers**: N/A
  - **Retroactive verification**: Next ensemble run should produce physically plausible detection rates (velocity-dependent impulse kicks now correctly scaled)

===== PR-PRIMORDIAL-F017-WALK COMPLETION CONTRACT - Fix KM_S_TO_AU_DAY conversion constant (factor ~86 error) =====