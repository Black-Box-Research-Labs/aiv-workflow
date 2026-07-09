# Machine-block schemas — prereq #1 (the deterministic-gate contract)

> **The #1 build blocker** (flagged independently by both the gate-schema and loop-terminator
> analyses). `check-drift`, `or-review`, and `aiv-audit` emit **prose** verdicts today; the
> orchestrator cannot gate on prose. Each must additionally emit a **`## Machine-checkable data`**
> fenced-JSON appendix — the `jsonBlock()` pattern already in `forensic_pipeline.mjs:167`. The
> orchestrator reads the **last** such block in the artifact, validates it against the schema below
> (reusing `validate()`/`coerceEnums()`), and evaluates the gate predicate **on the JSON fields —
> never on the prose**.
>
> This file is the contract. The implementing edits live in `Black-Box-Research-Labs/aiv-workflow`
> (the three `SKILL.md` files) and are **pending push** until that repo is reachable from a session.

## Convention
- Appendix heading exactly `## Machine-checkable data`, body a single ```json fenced block.
- The block is **derived from**, and must agree with, the prose verdict above it (a divergence is
  itself a fail — the orchestrator may diff key claims).
- A missing/unparseable/schema-invalid block ⇒ **HALT**, never advance (outage ≠ pass).

---

## 1. `check_drift_verdict` — Stage 3 / Loop #1 (plan convergence, GATE #1)
Source prose: check-drift `=== OVERALL VERDICT ===` panel (structural / quality / graph / HARD STOPS)
+ the tier table (audit depth) + 3.6 iter budget.

```json
{
  "schema": "check_drift_verdict@1",
  "r_tier": "R0|R1|R2|R3",
  "audit_depth_complete": true,
  "structural_integrity": "pass|fail",
  "plan_quality": "pass|partial|fail",
  "plan_graph": "pass|partial|fail",
  "hard_stops": [{"id": "string", "phase": "string", "detail": "string"}],
  "missing_sections": [{"section": "§15 risks+RED", "detail": "no RED stop-conditions", "na_ok": false}],
  "open_substantive_losses": 0,
  "iteration": 1
}
```
**`missing_sections` (required).** When `structural_integrity:"fail"`, the *specific* required-template
sections that are absent MUST be listed here — each with `section`, `detail`, and `na_ok` (`true` =
the section is justifiably N/A for this finding's context, e.g. no memory store loaded; does NOT
block). This closes a real contract bug: a structural fail with empty `hard_stops` used to be
*unactionable* by the loop (the gaps lived only in the prose verdict). The skill must emit a
`missing_sections` entry for every structural gap it reports. **This field is LOAD-BEARING now, not a
follow-up:** GATE #1 below consumes `missing_sections.filter(m => !m.na_ok)`, and the orchestrator injects
this field into the check-drift stage's OUTPUT CONTRACT (README prereq #1), so the machine block carries it
regardless of the upstream skill template. A malformed/absent block fails schema-validation → a clean
fail-closed HALT (with retry), never a crash. (Earlier drafts called this a pending follow-up — corrected
2026-06-21 after two pilot agents flagged the stale wording.)

**GATE #1 predicate (`PLAN_CONVERGED`):**
`audit_depth_complete === true && plan_quality !== "fail" && plan_graph !== "fail" && hard_stops.length === 0 && missing_sections.filter(m => !m.na_ok).length === 0`
(`plan_quality:"partial"` passes only with zero hard-stops — ratified knob; structural failure is now
expressed through `missing_sections`, so the bare `structural_integrity` flag is no longer the gate.)
Else **loop** to plan (cap 4; same `hard_stops`+`missing_sections` signature twice ⇒ no-progress HALT).

---

## 2. `or_review_verdict` — Stage 10 / Loop #2 (impl convergence, GATE #2)
Source prose: or-review comment header (`Verdict`, `Contract X/N`, `Round`, `headRefOid`) +
`protocol.md` scoring + the verification-claims (4a–4d) table.

```json
{
  "schema": "or_review_verdict@1",
  "round": 1,
  "head_ref_oid": "abc1234",
  "verdict": "PASS|WARN|FAIL",
  "contract_total": 0,
  "contract_verified": 0,
  "contract_na": 0,
  "falsified_load_bearing": 0,
  "unverified": 0,
  "stop_condition_tripped": "none|no-verify|attribution|unexplained-patch",
  "coderabbit_actionable": 0,
  "aiv_classes_present": ["A","B","C","D","E","F"],
  "aiv_classes_vacuous": []
}
```
**Contributes to the Stage-12 terminator** (`IMPL_CONVERGED_THIS_ROUND`):
`(contract_verified + contract_na) === contract_total && verdict === "PASS" && unverified === 0 && falsified_load_bearing === 0 && stop_condition_tripped === "none" && coderabbit_actionable === 0 && {A..F} ⊆ aiv_classes_present`. (An N/A contract item counts toward `contract_total` via `contract_na`. `gateOrReview` does NOT check `aiv_classes_vacuous` — vacuity is aiv-audit's authoritative domain, per `#29`; the field is still emitted for aiv-audit to consume.)
Terminate only when this holds for **N=2 consecutive rounds at the same `head_ref_oid`** (any push
resets the streak). Round cap 6; `stop_condition_tripped !== "none"` ⇒ immediate HALT.

---

## 3. `aiv_audit_result` — Stage 10 companion (packet content audit)
Source prose: aiv-audit's spec-finding-form findings + the all-class mandate (vacuous/empty class =
finding) + `aiv check` shape result it builds on.

```json
{
  "schema": "aiv_audit_result@1",
  "packet_decision": "COMPLIANT|CONDITIONAL|NON-COMPLIANT",
  "shape_check_passed": true,
  "blocking_findings": [{"packet": "string", "spec_finding_id": "string", "detail": "string"}],
  "classes_vacuous_or_na_unjustified": []
}
```
**Gate predicate:** `packet_decision !== "NON-COMPLIANT" && blocking_findings.length === 0 && shape_check_passed === true`.
A class present-but-vacuous (no falsifiable N/A rationale) is a blocking finding — defeats the
"fill all six boxes with nothing" rubber-stamp.

---

## Cross-cutting rules (all three)
1. **Schema-validate-and-retry.** Invalid JSON ⇒ re-request once with the exact `validate()` errors
   fed back (the `forensic_pipeline.mjs:302` pattern); a second failure ⇒ HALT.
2. **Fresh isolated context per judge.** Each verdict is produced by a new `claude -p` subagent that
   sees only the artifact + spec, never the build agent's reasoning (SoD). 3-judge majority for R2+.
3. **Outage ≠ pass.** Empty/low-coverage verdicts (e.g. an or-review with an empty 4a–4d table, an
   aiv-audit with 0 claims examined) HALT, mirroring the `<60%`-adjudication / no-falsification HALTs
   (`forensic_pipeline.mjs:451,465`).
4. **The orchestrator computes the boolean**, never the judge's "looks good" prose.
