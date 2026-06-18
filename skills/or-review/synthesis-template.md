# Synthesis template - verbatim PR comment

Fill the slots, then post via `gh pr comment <N> --body "$(cat <<'EOF' ... EOF)"`. Exactly ONE comment
per round. Project facts come from `.aiv-workflow.yml`; substitute configured values for any
`<angle-bracket>` key (a blank key -> the row is `N/A (not configured)`).

---

```markdown
## 🤖 Orchestrator review - PR Round <R>

**Branch:** `<headRefName>` @ `<headRefOid[:8]>`
**Mode:** <STRICT | DERIVED | SCAFFOLD (minimum)>
**Verdict:** <PASS | WARN | FAIL>
**Contract:** <X>/<N> verified  (<H high / M medium / L low confidence>  - DERIVED mode only)  <-- N = COUNT of items actually present, NOT max slot number; see "Item counting" below
**Methodology:** `/or-review` (5 angles + 4a-4d verification)

<IF DERIVED MODE - include this paragraph verbatim:>
> ℹ **Derived mode** - no per-PR contract file found; the engine generated one from the PR body + linked issue + diff + coordination doc + memory signals. Confidence-tagged. Saved to `<review.contracts_dir>/<derived-pr-slug>-completion-contract-DERIVED.md`. The operator may edit it + drop the `-DERIVED` suffix to promote it to strict for the next round.
</IF>

<IF SCAFFOLD (minimum) MODE - include this paragraph verbatim:>
> ⚠ **Scaffold mode (minimum)** - neither a contract file nor sufficient derivation signal was found (PR body empty or docs-only diff). Verification limited to universal discipline checks. Write `<review.contracts_dir>/<pr-slug>-completion-contract.md` for the next round.
</IF>

<IF R >= 2 - include this paragraph:>
### Prior round
- Resolved: <list R-1 items now verified>
- Re-flagged: <list R-1 items still failed or regressed>
- New: <list items that appeared this round>
</IF>

### Spec / design-doc alignment (Angle 1)

<2-3 sentence paragraph from Angle 1's claims. Cite the progress-tracker IDs delivered. Flag scope drift vs the plan slot if any.>

### Code / diff / cascading effects (Angle 2)

<2-3 sentence paragraph from Angle 2's claims. Highlight backward-compat status, any downstream caller hazards, any patch-around-instead-of-fix patterns.>

### Test / TDD / assertion-to-code alignment (Angle 3)

<2-3 sentence paragraph from Angle 3's claims. Per-contract-item spec-coverage summary. Flag any .skip / .todo / spec-impl-same-commit (not TDD).>

### Bug-catalog completeness (Angle 4)

| Functional file | Catalog | IDs listed | Pinned in specs | Unpinned IDs |
|---|---|---|---|---|
| `<path>` | Y/N | <comma list> | <count/total> | <comma list> |

<...one row per functional file added/modified...>

### Discipline (Angle 5)

| Check | Status |
|---|---|
| Atomic-commit policy | <N/M commits compliant; cluster pattern documented Y/N> |
| Verification packets (`<aiv.check_cmd>`) | <N/M packets pass the aiv CLI; cite any findings it printed> |
| No agent attribution | ✓ / ✗ <evidence> |
| No `--no-verify` / `--amend` | ✓ / ✗ |
| Coordination file row | ✓ / ✗ / N/A (not configured) |
| Progress-tracker closure annotated | ✓ / ✗ / N/A |
| CR-quiet-window | ✓ / ✗ / N/A |

### Memory-honor audit

<one bullet per cited rule - universal principle or host-memory entry handle - Y/N + 1-line evidence>

- No autonomous merge: <honored / N/A - merge gate remains operator's>
- Rebase-merge only: <intent confirmed in PR body OR N/A>
- Read the CR review body: <body read; result>
- Check state before acting: <4a-4d ran; result>
- Validate packets via aiv CLI: <packets checked via `<aiv.check_cmd>`; result>
- <host-memory entries matched by the diff signals, one per line>

### Completion contract - <N> items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | <verbatim from contract> | ✓ / ✗ / ? | `file:line` or `commit-sha` or "missing" |
| 2 | ... | ... | ... |
| <N> | ... | ... | ... |

### Verification claims (4a-4c)

| # | Claim | Probe | Result |
|---|---|---|---|
| 1 | <load-bearing claim from Phase 1> | <bash command or file:line probe> | ✓ <evidence> / ✗ <evidence> / ? <reason unverifiable> |
| ... | ... | ... | ... |

<IF any FALSIFIED + load-bearing - include the discrepancies section:>
### Discrepancies (4d)

- **Falsified load-bearing claim**: <claim text>
  - **Sub-agent angle**: <which angle returned this>
  - **Direct check result**: <what the probe actually showed>
  - **Impact**: <why this blocks the recommendation>
</IF>

### Recommendation

<IF verdict == PASS:>
**Merge-ready.** All contract items green; fan-out angles converge; discipline intact.

Operator next steps:
1. AskUserQuestion -> yes
2. `gh pr merge <N> --<merge.strategy> --delete-branch`
3. Post-merge: coordination file -> Closed rolldown (if configured); progress-tracker IDs final-CLOSED with the merge SHA (if configured)
</IF>

<IF verdict == WARN:>
**Address <N> items before merge.** No load-bearing failures, but soft issues need closure.

Action items for the implementation agent:
1. <specific actionable, file:line, expected fix>
2. ...

Re-run `/or-review <PR#>` after pushing fixes; the round will auto-increment to <R+1>.
</IF>

<IF verdict == FAIL:>
**FAIL - load-bearing items unmet.** Do not merge.

Action items for the implementation agent:
1. <specific actionable, file:line, expected fix>
2. ...

The operator should review the Discrepancies section before deciding whether to address or scope-cut.

Re-run `/or-review <PR#>` after pushing fixes.
</IF>

---
_Posted by the `/or-review` skill. Re-run for Round <R+1> after fixes are pushed._
```

---

## Filling guidelines

### Item counting (denominator for `X/N`)

`N` is the **count of items actually present** in the source contract, NOT the highest item number.
Some hand-written contracts skip numbers (e.g. a contract that jumps `[1][2][3][5][6]...` with no
`[4]` has one fewer real item than its max slot suggests).

To compute `N` reliably:

```bash
# Count actual items in the contract - match the leading `[<digits>]` token
grep -cE '^\[[0-9]+\]' <contract-file>
```

`X` = count of items marked ✓ (verified) in your Stage 7 output table. `?`, `✗`, and `N/A` are NOT
counted toward `X`.

The contract table you emit MUST reflect the same set: include EVERY item present in the source (even
gaps in numbering), and OMIT slots that are absent. If you encounter a slot gap, note it once at the
bottom of the contract table:

> Note: source contract has no item `[4]` between `[3]` and `[5]` (authoring artifact in `<contract-path>`); the denominator counts actual items present.

This prevents the bug where an `8/12` summary actually means "8 of 11 real items + 1 phantom slot" -
operators read `8/12` as "missed 4" when it's really "missed 3."

### Verdict computation

- Start with `verdict = PASS`.
- Each stop condition tripped -> `verdict = FAIL`.
- Each load-bearing contract failure -> `verdict = FAIL`.
- Each non-load-bearing failure -> if currently PASS, `verdict = WARN`.
- Each `?` in a core mechanical item -> `verdict = WARN` at minimum.
- CR-quiet-window broken -> at minimum WARN (per `protocol.md` stop conditions).

### "Load-bearing" definition

A claim/item is load-bearing if its failure invalidates the PR's stated goal. The atomic-commit /
packet-validity / no-attribution items are ALWAYS load-bearing. The coordination-file and
progress-tracker items are NOT load-bearing (process compliance, fixable post-merge). PR-specific
items are load-bearing iff they reflect a goal stated in the PR body.

### Length budget

The whole comment should fit in a GitHub PR comment without scrolling fatigue. Hard cap: ~300 lines
of markdown. Trim verbose evidence to `file:line` + a 1-sentence quote. Summarize sub-agent returns;
do not paste them.

### Tone

Neutral, evidence-first. Avoid praise ("great work") and editorializing ("this is concerning"). State
findings, cite evidence, recommend action. Terse + actionable beats hedging.

## Machine-checkable data (REQUIRED - append to the posted PR comment)

Append this as the **last** `## Machine-checkable data` fenced block of the single PR comment, so the
orchestrator reads the verdict as JSON (never the prose). It MUST agree with the header `Verdict`/`Contract`.

```json
{
  "schema": "or_review_verdict@1",
  "round": 1,
  "head_ref_oid": "<headRefOid full sha>",
  "verdict": "PASS|WARN|FAIL",
  "contract_total": 0,
  "contract_verified": 0,
  "falsified_load_bearing": 0,
  "unverified": 0,
  "stop_condition_tripped": "none|no-verify|attribution|unexplained-patch",
  "coderabbit_actionable": 0,
  "aiv_classes_present": ["A","B","C","D","E","F"],
  "aiv_classes_vacuous": []
}
```

Terminator (Stage 12): `contract_verified===contract_total && verdict==="PASS" && unverified===0 &&
falsified_load_bearing===0 && stop_condition_tripped==="none" && coderabbit_actionable===0 &&
{A..F}⊆aiv_classes_present && aiv_classes_vacuous.length===0`, stable for N=2 rounds at the same
`head_ref_oid` (any push resets the streak).
