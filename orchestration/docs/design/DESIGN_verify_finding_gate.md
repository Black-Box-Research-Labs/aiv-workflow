# DESIGN — verify-finding (H1 falsification gate) + the refuted escape hatch

> **Status:** design, 2026-07-05. **Motivation (operator, F017 walk):** the pipeline TRUSTS the finding
> axiomatically — launch-brief even states "the audit already survived adversarial falsification" — and every
> downstream gate judges consistency WITH the finding, never its truth. A false finding rides the whole spine:
> design-tests manufactures a RED test asserting the finding's wrong expectation (correct code makes it red),
> test-quality blesses it (red for the right reason *per the finding's frame*), write-code "fixes" correct code
> into a real bug, prove-it captures a self-consistent RED->GREEN, or-review verifies claims against internally
> consistent evidence — H2 receives a wrong change with immaculate packets. The goal loops actively FORCE a
> balking model back into compliance (zero commits = malfunction -> retry/resample); "finding refuted" is not a
> legal state. Queue findings come from an LLM static audit — exactly the input class needing falsification.

## 1. Two-part fix (prevention + recovery, per the standing rule)

**Prevention — Stage `verify-finding`:** a gated, readOnly, adversarial stage run BEFORE the build stages.
Task: attempt to REFUTE the finding. Construct a minimal runnable reproduction of the claimed defect at the
pinned baseline (compute the value, run the scenario, read the cited code path) and emit a `finding_verdict`:

```json
{ "schema": "finding_verdict@1",
  "verdict": "reproduced" | "refuted" | "inconclusive",
  "repro_command": "<single runnable command demonstrating the defect or its absence>",
  "observed": "<what the command shows>",
  "expected_per_finding": "<what the finding claims it should show>",
  "reasoning": "<why this observation confirms/refutes the claimed defect>" }
```

- `reproduced` -> gate PASSES, walk proceeds (the finding earned its 14 stages).
- `refuted` -> **HALT-REFUTED**: a first-class terminal (exit code 5, distinct from HALT=3/gate=4), marker
  `WORK/REFUTED_<id>.md` with the refutation evidence, queue write-back noted for the kit repo. NOT a failure —
  the gate did its job; the AUDIT gets the bug report, not the repo.
- `inconclusive` -> proceed WITH a caveat injected into the brief/H2 register (default), or halt under
  `FIX_VERIFY_FINDING_STRICT=1`. Rationale: a weak model failing to construct a repro is NOT evidence of
  falsity; defaulting inconclusive->halt would let judge weakness starve the queue (the mirror image of the
  judge-churn seam). REFUTED requires AFFIRMATIVE evidence of correctness, not absence of reproduction.

**Harness re-execution (trust the artifact, not the claim):** after parsing the verdict, the harness RUNS
`repro_command` itself in the worktree (bounded), captures output to `WORK/finding_repro_<id>.txt`, and stores
it alongside the verdict. v1 stores it as evidence for the queue/H2; it does not auto-judge semantics (the
command's meaning is the agent lane; its execution is the deterministic lane).

**Recovery — the design-tests escape hatch:** the forcing loop gains a legal exit. design-tests' contract adds:
"If you cannot make a test fail ON THE FINDING'S DEFECT because the production code is actually CORRECT, do
NOT manufacture redness (asserting the finding's wrong expectation against correct code is fabricating a bug).
Emit a `finding_verdict` machine block with verdict=refuted + your repro evidence instead — that is a valid,
successful outcome of this stage." The harness checks the agent result for a schema-valid refuted verdict
BEFORE the no-commits retry logic, and routes it to the same HALT-REFUTED terminal. Defense in depth: falsity
that only becomes visible at test depth still has an exit.

## 2. Placement + env

Spine: immediately after `ground` (the provisioned .venv exists, so repros can import the target code); before
design-tests. Costs brief+plan on a fake finding (~2 model runs) — acceptable v1; promoting it before
launch-brief (with lazy provisionEnv) is a follow-up once calibrated. Supervised walks run it standalone via
`--run-stage verify-finding` right after worktree+provision.

## 3. Hardened-pattern reuse

| Piece | Reused pattern |
|---|---|
| Stage def | `check-drift` (readOnly, MODEL_GATE, machine block at given path) |
| Verdict schema+gate | `check_drift_verdict` / `gateTestQuality` |
| Adversarial default | test-quality skill posture ("default to FAIL/REFUTE on uncertainty" -> here: default to `inconclusive`, never to `refuted`, on uncertainty) |
| Harness re-execution | prove-it's trust-the-artifact posture + #126 facts-not-judgments |
| Distinct terminal | HALT (3) / gate-fail (4) precedent -> REFUTED (5) |

## 4. Calibration test (the acceptance, on a fake finding — operator-specified)

Same baseline worktree (PrimordialEncounters @ origin/master, pre-fix):
1. **FAKE F998**: "DEFAULT_MASS_RANGE_MSUN upper bound is 1e-3 (should be 1e-6), producing 1000x overmassive
   PBHs" — plausible phrasing, concretely FALSE (code says `(1e-12, 1e-6)`), refutable by one import.
   Expected: `refuted` -> exit 5 + REFUTED marker. (Before the gate: this finding would have driven the full
   spine and 'fixed' a correct constant.)
2. **REAL F017**: the original constant bug (present at master). Expected: `reproduced` -> gate PASS.
Both directions must hold: a gate that refutes real findings is worse than no gate.

## 5. Risks
- **False refutation of a real finding** — the worst failure. Mitigations: refuted requires affirmative repro
  evidence; harness re-executes the command; inconclusive is the uncertainty bucket; calibration test #2.
- **Judge nondeterminism** — same class as #124/#125; single-shot gate (no fix loop), and the verdict carries
  a runnable artifact any later reader can re-execute.
- **Findings needing complex setup** (integration-level defects) — expect `inconclusive`, which proceeds with
  a caveat; strict mode exists for high-cost drives.
