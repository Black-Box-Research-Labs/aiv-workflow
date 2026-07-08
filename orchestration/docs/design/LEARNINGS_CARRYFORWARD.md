# Learnings carry-forward — `forensic_pipeline.mjs` (11+ audits) → `fix_pipeline.mjs`

Systematic line-by-line comparison of every robustness mechanism the old harness earned across the
cultivation / RNA / pytest / DocInsight / mastery / Mito / openclaw audits, against the new fix-side
harness. Each is **CARRIED-NOW** (in the hardened `fix_pipeline.mjs`), **DEFERRED** (a must-carry that
was recorded as a cited TODO so it is NOT lost), or **NOT-INHERITED** (with the reason, per the old
file's own "Deliberately NOT inherited" note).

> **STATUS UPDATE 2026-07-04 — prereq #1 LANDED; the live runner is WIRED.** This file was written
> while the per-stage runner was still stubbed. The runner (`runLiveStage` → `claude -p`) has since
> gone live and driven real full-spine PRs to H2 (F8 #50, RNA s2c3l0-020 #87, F354 #51; see
> `RNA_RUN_LOG.md` + `RUN_OBSERVATIONS.md`). **Almost the entire DEFERRED table below is now
> CARRIED** — the reconciliation is in the DEFERRED section header. Only three items remain genuinely
> open (3-judge majority, markdown pipe-safety, RUN_ID/pMap/--fresh).

> Why this file exists: a skeleton that passes its own fixtures is not robust. Robustness is
> *inherited* from the failure modes 11+ audits already paid for. This is the audit of that
> inheritance.

## CARRIED-NOW — implemented + selftested in `fix_pipeline.mjs`

| Learning | Source | Old ref | How carried |
|---|---|---|---|
| Tolerant JSON parse (BOM/fence/brace-slice) | [RNA] | `tolerantJson` :108 | `tolerantJson()` |
| Machine-block extraction (read the `## Machine-checkable data` block, not prose) | [DocInsight] `jsonBlock` | :167 | `extractMachineBlock()` (takes the LAST block) |
| Enum-drift coercion before validate | [cultivation] | `coerceEnums` :126 | `coerceEnums()` + `ENUM_SYNONYMS` (PASS/passed, COMPLIANT/compliant…) |
| Recursive, **enum-value-checked** validation | [cultivation/RNA] | `validate` :143 | `validate()` (type+enum+required+nested+array) |
| Outage ≠ pass → HALT | [pytest no-falsify :451 / RNA <60% :465] | — | `readVerdict()` HALTs on missing/unparseable/invalid block |
| Durable state + checkpoint/resume | [RNA sub-stage resume] | `loadState/checkpoint` :186 | `loadState/saveState/checkpoint`, per-finding `state.findings[id]` |
| Durable HALT + report on disk | forensic `halt()` | :193 | `halt()` writes `HALT_<finding>.md` + sets `status:"halted"` |
| Halt exit-code semantics (Halt=3, fatal=2) | forensic `main().catch` | :694 | top-level `try/catch` |
| `--selftest` zero-API assertions | [RNA] | :625 | 31 checks (gates + validator + coerce + parse + extract + state) |
| `--dry-run` zero-API end-to-end | [skill] | :232 | full 14-stage flow on machine-block-wrapped fixtures |
| Convergence as caps + no-progress + delta | [skill fixpoint :471] | — | Loop#1 cap+hard-stop-signature; Loop#2 cap+`headRefOid` streak |
| Cost tracked, **never gated** (subscription) | [mastery] header | :24–30 | documented principle; no dollar cap — bound by `--max-turns`+timeout when wired |

## DEFERRED → NOW CARRIED — reconciled 2026-07-04 (prereq #1 landed)

The runner is live, so the "must-carry when wiring" list below was audited against the shipped
`fix_pipeline.mjs`. **Carried** rows cite the implementing line; **STILL OPEN** rows are the three
residuals that the live runner has not yet earned (none has bitten a real drive — recorded so they
stay tracked).

| Learning | Source | Status in live `fix_pipeline.mjs` |
|---|---|---|
| `spawn` **error handler** so a missing binary can't hang the promise | [cultivation/mastery] | **CARRIED** — `p.on("error", …)` in `runLiveStage` :2662; `spawnClaude`/`runAgent` too |
| **Stale-file delete** before each attempt (never read a prior attempt as success) | [pytest] | **CARRIED** — blank the gate outfile before spawn, :388 |
| **Error-feedback retry** — feed the exact `validate()` errors back into the next prompt | [cultivation] | **CARRIED** — goal-loop `feedback` re-injection, :2653/:2685 |
| E2BIG prompt **spill-to-file** for huge prompts | [cultivation] | **CARRIED** — `needsSpill`/`spillPrompt` :351–363, used at :2654 |
| **Usage-limit-aware backoff** (rate-limit → longer sleep) | [RNA] | **CARRIED** — `transientAgentError`+`backoffMs` retry loop :2658–2670 |
| **INVARIANTS** injected into every stage prompt — esp. **#6 PII/PHI/secret safety**, output-contract, adversarial verification | [all] | **CARRIED** — `INVARIANTS` via `--append-system-prompt` :289–302; `scrubText` redaction :2260 |
| **Auto-preflight gate** — one cheap call proving auth + tool-use + file-handoff before the long run | [mastery] | **CARRIED** — `doPreflight` :409, gated at `driveSpine` :3008 |
| **Model tiering** (opus for gates/judges, fast for execute) + runtime resolution | [pytest/RNA] | **CARRIED** — `MODEL_GATE/EXEC/CHEAP/CODE` :277–280. NB: `--fallback-model` is superseded by the OpenRouter cascade shim (`drivers/openrouter/`), not a CLI flag |
| `gitPersist` commit-per-stage + **exponential-backoff push** | [all] | **CARRIED** — `gitCheckpoint` :450, `pushHead` (`--force-with-lease` + backoff) :433 |
| **Orchestrator runs the checks** (harness runs CI / `aiv check` / tests; agent only analyzes) | [mastery] | **CARRIED** — `fullSuiteRegression` :2070, `verifyCmd` goal-loop, `ciStatus` :934, `aivCheckShape` :1169 |
| **Separate adversarial falsifier / fresh context per judge** (SoD) | [pytest, INVARIANT 4] | **CARRIED** — `or-review`/`aiv-audit` are isolated `readOnly` opus subagents; verdicts written off-branch |
| **3-judge majority** for high-stakes gates (R2+ plan/review) | [mastery] | **STILL OPEN** — gates run a single opus judge; no quorum. Mitigated by no-progress + oscillation detectors, not a panel |
| Pipe/newline-safe markdown `esc()`/`tbl()` — when writing PR bodies / status comments | [Mito] | **STILL OPEN** — PR bodies are written from the aiv packet file directly; no dedicated markdown-escape helper |
| `RUN_ID` file namespacing, bounded-concurrency `pMap`, `--fresh` teardown | [cultivation/all] | **STILL OPEN** — per-finding `.work/<id>/` namespacing exists, but RUN_ID/`pMap`/`--fresh` remain deferred (confirmed in-code at :1656). `pMap` is N/A to a single-finding drive |

## NOT-INHERITED — deliberately, with reason

| Mechanism | Why it stays out of the fix pipeline |
|---|---|
| **Dollar budget cap** | Subscription cost is API-*equivalent* (~10–100× the real draw); a cap truncates legitimate work. Bound runaway with `--max-turns` + timeout, not dollars (same call the old file made, :24–30). |
| **Repo file enumeration / IGNORE / binary-by-extension** | N/A: the fix pipeline operates on **one finding**, not a whole-repo sweep. Finding selection is `build_queue.py`'s job, not the orchestrator's. |


<!-- auto-captured 2026-06-19 16:21:26 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-19 (awaiting-H2)
- All packet metadata fields (Repository, blast_radius enum) must be validated at commit time — content-audit is too late and forces a remediation loop that costs a full pipeline re-run
- gh availability must be treated as an infra pre-flight gate; file-based review fallback is acceptable but must be declared explicitly so the human knows PR comments are absent
- Branch name must be enforced against the contract's expected pattern at pipeline entry, not surfaced as a judgment-call at the terminal review stage
- Option A (ground-truth DB read via hub) is the correct pattern for any scheduler value that depends on persisted history — never let the scheduler approximate what the hub can look up
- Literal numeric assertions in completion contracts (e.g., '15 tests') drift as tests are added; write contracts with >= bounds or omit counts entirely


<!-- auto-captured 2026-06-19 23:02:42 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-19 (awaiting-H2)
- Always copy Class E URL verbatim from the finding's CANONICAL INTENT field — never re-derive from taskmaster or launch-brief context
- aiv-audit verdict must carry and be validated against finding_id before parsing; scope mismatch is not an outage
- Namespace all finding-specific .work/ artifacts under .work/<finding_id>/ at preflight to prevent cross-run artifact bleed
- Per-stage cost telemetry must be recorded in state.json at stage completion time; run-level aggregates are insufficient for retrospective triage


<!-- auto-captured 2026-06-20 15:08:18 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-20 (awaiting-H2)
- In headless environments (no gh), declare Class A exception with sha256-manifest substitute at write-code time, not retroactively at aiv-audit
- Caller-grep for zero production callers must scope to package source root and explicitly exclude tests/ and .github/ to produce a clean zero-match
- cr-review 'no machine block' is a predictable failure mode; add retry-with-template-injection step before escalating to HALT
- Record aiv-audit, check-drift, and or-review as distinct timestamped entries in state.json — not only as verdict files — to enable full run cost and timing reconstruction
- For legacy-encoder hotfixes, pre-verify 'zero production callers' and 'sibling symbols intact' in prove-it evidence collection to reduce or-review triage load


<!-- auto-captured 2026-06-20 19:53:06 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-20 (awaiting-H2)
- Validate aiv packet glob path before CLI invocation; surface resolved path in any cli:0/0 HALT — never let the HALT body be opaque
- Treat aiv check exit code as authoritative over banner text; 'Validation Failed' + exit 0 is warnings-only, not a blocking failure
- Record baselineNonTestFail as a named evidence artifact (baseline_nontestfail.txt) at ground stage, not only as a boolean in state.json
- Any live-fire capture serving as the finding's completion criterion must be a separately SHA-256-hashed file; inline packet paste does not satisfy Class A A-002
- Class E canonical audit URL must be checked at design-tests or write-code, not deferred to pr-summary — late enforcement costs a full HALT cycle


<!-- auto-captured 2026-06-21 01:35:14 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-21 (awaiting-H2)
- Pin packet Head SHA to `git rev-parse HEAD` after the last functional commit, never before — an intermediate SHA in a multi-commit fix makes load-bearing claims false at the declared anchor
- Derive machine JSON commits[] from git log output and validate each SHA with git cat-file -e before committing the packet
- aiv-audit CONDITIONAL/BLOCKING must be a hard prerequisite gate for or-review; behavioral correctness does not substitute for packet integrity


<!-- auto-captured 2026-06-24 18:16:37 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-06-24 (awaiting-H2)
- Enumerate every GOAL clause in a classification table before locking plan decisions — unclassified clause = primary-deliverable-dependency, no exceptions
- Re-verify all Class B line anchors against live file immediately before aiv close, not at claim-draft time
- Class C evidence must be a runnable command + 0-matches result, never prose narrative alone
- When baselineNonTestFail is set, surface the failing command and stderr before proceeding — silent boolean blocks diagnosis
- Record the reason and timestamp for any inter-stage hold exceeding 1 hour in state.json so gaps are attributable not UNKNOWN


<!-- auto-captured 2026-06-25 00:02:32 by --memory-retro; PENDING CURATION — VOIDED on human review -->
## Auto-captured carry-forward — 2026-06-25 (awaiting-H2) — ⚠ VOIDED
> These were auto-captured from the F354 memory-retro, which the free-model driver authored with
> hallucinations (a fabricated "pydocstyle CI failure" — F354 is an R0 docstring change with no
> doc-lint CI). Both lessons derive from that false premise and are **not adopted**. See the
> CORRECTION block in `RUN_OBSERVATIONS.md`. Real lesson recorded instead:
- Free-model output at NON-GATED stages (memory-retro) is unverified and must be human-reviewed before
  it feeds the corpus/learnings — the schema-validated gates do not cover narrative-synthesis stages.


<!-- auto-captured 2026-07-07 13:31:32 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-07-07 (awaiting-H2)
- Align dictionary key names across modules via shared constants or schema
- Add explicit unit tests for each external sampler key
- Record early failure modes to guide fix scope


<!-- auto-captured 2026-07-08 03:54:09 by --memory-retro; PENDING CURATION — not yet folded into the tables above -->
## Auto-captured carry-forward — 2026-07-08 (awaiting-H2)
- Always validate packet documentation with `aiv check --strict` and ensure evidence is immutable, self-contained, and includes explicit negative evidence details before PR submission.
