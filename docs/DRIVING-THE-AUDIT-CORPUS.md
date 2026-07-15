# Driving the AIV Audit Corpus Through the Fix Pipeline

*A systematic analysis of the audit → fix bridge: the transport that exists, the corpus that
feeds it, what has actually been driven, and the concrete steps to drive the `aiv-protocol`
forensic corpus.*

This document is the corpus-scale companion to [`DRAFTING-DRIVES.md`](./DRAFTING-DRIVES.md)
(which covers drafting **one** drive). It is grounded in a direct read of
`orchestration/src/fix_pipeline.mjs` (6145 lines), the two forensic corpora, and the 36-drive
training corpus — every claim carries a `file:line` or artifact citation.

---

## 0. Executive summary

**The question.** Given a forensic audit that produced a corpus of findings, *how do you drive
those findings through the fix pipeline* to get verified, evidence-backed fixes?

**The answer, in one paragraph.** The pipeline is a deterministic (non-LLM) harness,
`fix_pipeline.mjs`, whose *only* per-drive input is a small **spec JSON** describing one finding.
It runs ~14 stages as isolated `claude -p` subagents, gating each transition on the last
`## Machine-checkable data` JSON block a stage emits, and parks at a human merge gate
(`awaiting-H2`). A finding becomes a spec through a **mechanical intake path** that already
exists in code (`queue.jsonl` → `specFromRow` → `auditTableRow` → `materializeFinding`). The
corpus is **machine-readable** and the join key is the finding id (`F##`) lowercased to the
drive id (`f##`). **So the transport is built end-to-end — but the `aiv-protocol` corpus is not
wired into it.**

**The five headline findings.**

1. **The bridge is 90% built and 0% connected.** Every mechanical piece to turn a finding into a
   drive exists in `fix_pipeline.mjs` (`specFromRow` at `:815`, `auditTableRow` at `:866`,
   `materializeFinding` at `:978`, `--intake` at `:6032`). But there is **no `queue.jsonl`** in
   the repo — the intake queue those functions read is empty. Nothing has been *ratified* for
   driving.

2. **The `aiv-protocol` self-audit (147 distinct findings / 79-item plan) has NEVER been driven.**
   Of 36 training drives, exactly **two** target a forensic corpus — `fix-theirs-f20` and
   `fix-theirs-f316` — and those target the **black-box** repo's *sonnet* audit run, not
   `aiv-protocol`. Neither reached terminal. The 34 other drives are external projects
   (PrimordialEncounters, PromptVerge, flashcore, …).

3. **The load-bearing input is the oracle (`goalCondition`), and the corpus mostly lacks one —
   except `aiv-protocol`, which already carries oracle seeds.** Each of the 79 `aiv-protocol` plan
   items has a `Verification` column that is a concrete acceptance test
   (e.g. P16: *"a forced exception inside `_validate_packet` causes `main()` to block the commit"*).
   That is exactly the external, machine-checkable oracle `DRAFTING-DRIVES.md` says "is the whole
   game." **This makes `aiv-protocol` the most drive-ready corpus in the ecosystem.**

4. **`design-tests` is the pipeline's proven bottleneck.** Across all 36 drives it fails more than
   any other stage (53 FAIL vs 35 PASS) — writing a RED test that satisfies the gate is where
   agents burn the most time. Any corpus-drive plan must budget for this.

5. **A single audit run is stochastic; the corpus is over-counted.** The black-box cross-run
   comparison shows only **~21–26%** of findings reproduce across two model runs, and the
   `aiv-protocol` raw list has **251 findings for 147 real issues** (the SSRF appears 10×). The
   correct iteration unit is the **deduplicated plan item**, not the raw finding — and the
   pipeline's `verify-finding` gate (REFUTED → exit 5) is the built-in guard against driving
   phantom findings.

**Bottom line.** Driving the `aiv-protocol` corpus is a *wiring and prioritization* task, not a
capability gap: emit a namespaced `queue.jsonl` from the 79 dependency-ordered plan items, seed
each `goalCondition` from the plan's `Verification` field, and fan out one `--drive` per item in
`depends_on` order, security-first. A worked example already exists on this branch: commit
`55e1979` is the fail-closed test that driving **P16 / F43 (C1)** would produce.

---

## 1. The ecosystem: where the corpus and the pipeline live

Four repos, two layers, one loop:

```
  ┌─ FORENSIC AUDIT (the generator) ──────────────────────────────────────────┐
  │  black-box/skills/forensic-audit-pipeline/forensic_pipeline.mjs (766 ln)   │
  │  5-stage adversarially-gated audit → findings + remediation plan           │
  └───────────────┬───────────────────────────────────────────────────────────┘
                  │ emits
                  ▼
  ┌─ THE AUDIT CORPUS (the input) ────────────────────────────────────────────┐
  │  aiv-protocol/docs/audits/2026-06-18-forensic/  251 raw → 147 distinct     │
  │                                                 79-item plan (P1–P79)      │
  │  black-box/audit/                               1312 raw → 1064 distinct   │
  │                                                 188-item plan (F##-keyed)  │
  └───────────────┬───────────────────────────────────────────────────────────┘
                  │  ??? THE BRIDGE (finding → spec)  ← the subject of this doc
                  ▼
  ┌─ THE FIX PIPELINE (the driver) ───────────────────────────────────────────┐
  │  aiv-workflow/orchestration/src/fix_pipeline.mjs (6145 ln)                 │
  │  + 13 stage skills (aiv-workflow/skills/*)                                 │
  │  drives ONE finding: finding → plan → build → review → PR (awaiting-H2)    │
  └───────────────┬───────────────────────────────────────────────────────────┘
                  │ emits full trajectory
                  ▼
  ┌─ THE TRAINING CORPUS (the output) ────────────────────────────────────────┐
  │  aiv-polymath-traindata/  36 drives · 1517 step-records · ~$288 agent cost │
  │  drives/<id>/{steps.jsonl, manifest.json}   → distill cheaper drivers      │
  └───────────────────────────────────────────────────────────────────────────┘
```

- **`aiv-protocol` (Layer 1)** — the protocol + `aiv` CLI. Defines what evidence is valid,
  enforces it (hooks/guard/anti-cheat), collects it. **Also hosts its own forensic self-audit.**
- **`aiv-workflow` (Layer 2, here)** — the agent workflow: 13 skills + `fix_pipeline.mjs`. Skills
  *call* the `aiv` CLI; they never reimplement the spec (`README.md:16`).
- **`black-box`** — BBRL's forensic firm that audits external vendors *and* generated both
  forensic corpora; the `bb-audit` CLI and `forensic_pipeline.mjs` live here.
- **`aiv-polymath-traindata`** — the trajectories `fix_pipeline.mjs` emits, one dir per drive.

> **Scope note.** "The audit corpus of the aiv protocol" = the two 2026-06-18 forensic corpora
> (`aiv-protocol/docs/audits` + `black-box/audit`). `aiv-protocol/AUDIT_REPORT.md` is a *separate*
> 2026-02 manual "Cascade" audit (prose + `✅ FIXED` tags, no `F##` schema) and is **not** part of
> the machine-drivable corpus.

---

## 2. The fix pipeline — how one finding is driven

`fix_pipeline.mjs` is *"A DETERMINISTIC harness — not an LLM"* (`:5`). It owns control flow;
each stage is an isolated Claude subagent whose **last `## Machine-checkable data` fenced JSON
block** is the only thing the harness trusts (`extractMachineBlock` at `:107`). Gate functions
map a verdict schema → pass/fail (`GATE_FN`, `:486-492`), so the model is swappable with zero
pipeline changes.

### 2.1 Entry point and the one input

```bash
# THE SPINE — drive one finding (resumable):
export FIX_TRAINDATA_DIR=/path/to/traindata-clone   # MUST be a writable git clone or HALT (exit 3)
export GIT_TOKEN=ghp_...                             # GitHub API: PR, poll-ci, provenance tag
node orchestration/src/fix_pipeline.mjs --drive --spec <finding>.json --cwd <worktree>
```
- Entry: `main()` at `:5955`; the `--drive` branch is `:6038`; `driveSpine(spec)` at `:6081`.
- **Fail-closed on capture**: `FIX_TRAINDATA_DIR` must be a writable git clone, else *"refusing to
  run an uncaptured drive"* → exit 3 (`:6055-6065`). Every drive is recorded or it does not run.
- **Spec resolution** (`loadSpec`, `:831`): either `--spec <file.json>` (the spine's path) **or**
  discrete flags (`--finding-id --change-prefix --repo --cwd --intent-source --intent-line
  --plan-path --base --goal --finding`). `--cwd` always overrides `spec.cwd` (`:835`).

**Zero-/low-API modes** (use these to validate before spending tokens):
```bash
node orchestration/src/fix_pipeline.mjs --selftest                          # gates/validator/coercion
node orchestration/src/fix_pipeline.mjs --dry-run                           # full 14-stage flow, no API
node orchestration/src/fix_pipeline.mjs --drive --plan --spec <f.json>      # echo the PARSED spec, no side effects
node orchestration/src/fix_pipeline.mjs --seam-check --spec <f.json> --cwd <wt>   # deterministic RED@base/GREEN@HEAD
```

### 2.2 The spec schema (the entire per-finding contract)

Canonical template — `orchestration/bake/specs/spec_f017_template.json`:
```json
{
  "id": "F017",
  "repo": "ImmortalDemonGod/PrimordialEncounters",
  "cwd": "<WORKTREE — overridden per-run by --cwd>",
  "baseBranch": "origin/master",
  "changeIdPrefix": "primordial-f017-walk",
  "planPath": ".aiv/plans/primordial-f017-walk-plan.md",
  "intentSource": "audit/02-static-audit.md",
  "intentLine": 24,
  "bugSite": "`src/parameter_sampler.py:11`",
  "findingFile": "<BAKE_ROOT>/finding_F017.txt",
  "headBranch": "fix/bake-{L}",
  "goalCondition": "python -m src.parameter_sampler produces ~0.1-0.25 AU/day (was ~10-25); ...",
  "title": "F017"
}
```

| Field | Required? | Role |
|---|---|---|
| `id` | **required** | finding id (`F017`); hard-checked at `:4922` |
| `repo` | **required** | `owner/name`; PR + API target |
| `cwd` | **required** | worktree path (overridable `--cwd`) |
| `changeIdPrefix` | load-bearing | **the join key**: drive_id, head branch, packet names, provenance tag. Default `fix-${id.toLowerCase()}` (`:839`) |
| `goalCondition` | semantic core | the **machine-checkable "fixed" oracle**. Default null |
| `intentSource` / `intentLine` | optional | the **audit record** the finding lives in (Class-E intent) — *not* the code site. Default `audit/02-static-audit.md` (`:843`) |
| `bugSite` | optional | the code site the SEAM reverts |
| `baseBranch` | optional | default `origin/main` |
| `planPath`, `findingFile`, `headBranch`, `title` | optional | derived defaults |

**The spec is the *only* per-finding input.** All per-finding values reach stage prompts through
`applySpec` placeholder substitution (`{{FINDING_ID}} {{REPO}} {{CHANGE_PREFIX}} {{GOAL}}` …,
`:796-813`). No finding is hard-coded; a new finding needs only its spec, never a harness edit.

### 2.3 The ~14 stages, in execution order (`driveSpine`, `:4920-5083`)

| # | Stage | Skill / model | Gate (verdict schema) | HALT / loop |
|---|---|---|---|---|
| 0 | `preflight` | `doPreflight` / haiku | `pf.ok` | fail → exit 2 |
| 1 | `launch-brief` | `launch-brief` / EXEC(sonnet) | — (plain commit) | — |
| 2–3 | `plan` **Loop #1** | plan ⟷ `check-drift` / GATE(opus) | `check_drift_verdict` → `PLAN_CONVERGED` | same hard-stops 2× → HALT (exit 3); cap `PLAN_CAP=7` |
| 4 | `ground` | `provisionEnv` + baseline | non-functional venv → HALT (exit 3) | — |
| 4.5 | `verify-finding` | GATE | `finding_verdict` | **REFUTED → exit 5 (terminal success)**; reproduced → proceed |
| 5 | `design-tests` | `design-tests` / CODE | AIV packet valid + Class A–F + goal-loop | resample best-of-N (`RESAMPLE_N=3`) → fail-closed HALT ← **bottleneck** |
| 6 | `write-code` | (plan=program) / CODE | verify + regression + determinism + symbol-guard | resample |
| 7 | `prove-it` **SEAM** | `prove-it` / EXEC | `prove_it_manifest`, `unverified_count===0`, RED@base/GREEN@HEAD | gate fail → HALT (exit 3) |
| 8 | `open-pr` | `openOrUpdatePR` | packet exists / PR opens | missing packet → HALT (exit 3) |
| 9–12 | `backhalf` **Loop #2** | reconcile→cr-review→justify-audit→`aiv-audit`+fix→pr-summary→poll-ci→`or-review` | `or_review_verdict` PASS + stable | oscillating → HALT (exit 3); cap `IMPL_CAP=6` |
| 12b–c | `ci-final`, `provenance-tag` | `confirmCiSettled`, `createProvenanceTag` | CI green; annotated **`aiv/<changeIdPrefix>`** tag | tag fail → HALT (exit 3) |
| 13 | `deferred-issues`, `surface-advisories` | EXEC | advisories must surface | unsurfaced → HALT (exit 3) |
| T | `memory-retro` → **`awaiting-H2`** | writes manifest, pushes trajectory | — | **`SPINE COMPLETE`** — parks at the human merge gate; **agents never merge** (`:5081`) |

Two hard invariants make the evidence trustworthy (`docs/PIPELINE.md:98-121`):
- **Context isolation at the build→review seam** — the reviewer (`or-review`/`aiv-audit`) receives
  the PR + spec + evidence, **never the implementer's reasoning**. H2 is the single independent verifier.
- **Evidence chain** — `finding (line#, cited SHA) → launch-brief acceptance → plan verified-state
  → aiv-packet Class E (intent = the finding, immutable) → prove-it cited baseline → aiv-audit
  claim↔evidence → H2 judges`. Nothing is asserted that isn't anchored to the finding's evidence.

**Front-half vs back-half** (the traindata "fix #57" split): front-half stages run through
`runLiveStage`→`spawn("claude")` (`:4079`); the back-half runs through `spawnClaude`/`ciFixAgent`
(`:1449`/`:1351`). Both are now captured to the trajectory.

**HALT exit codes**: `3` = fail-closed HALT, `2` = FATAL, `4` = deterministic gate/artifact fail,
`5` = finding REFUTED (a *successful* terminal — the finding didn't reproduce, so it wasn't driven).

### 2.4 Driver, output, and batch

- **Driver.** Every stage literally spawns `claude` (`-p … --model … --output-format json
  --allowedTools Read,Grep,Glob,Write,Edit,Bash`, `:4073`). To use a cheaper model: (1) PATH-shim
  `drivers/openrouter/bin/claude` → `claude-or-shim.mjs` (free-tier OpenRouter cascade) or the
  local `drivers/local/Modelfile.qwen3.5-0.8b`; (2) per-tier env `FIX_MODEL_GATE`(opus) /
  `FIX_MODEL_EXEC`(sonnet) / `FIX_MODEL_CODE` (`:543-546`).
- **Trajectory.** `recordStep` (`:2993`) appends one line per spawn to `drives/<id>/steps.jsonl`
  (**including failed goal-loop attempts — negative examples**); `writeTraindataManifest` (`:3073`)
  writes the terminal `manifest.json`. `scrubText` (`:2981`) **drops** high-confidence secrets and
  **redacts** PII before every write — *"a hole in the corpus beats a memorized key in a model."*
- **Batch.** There is **no native multi-finding loop** — `driveSpine` takes exactly one spec, and
  `drive_supervisor.sh` only *resumes* the same finding (up to 40 attempts). Corpus fan-out is
  **external**: one `drive_supervisor.sh spec_<id>.json log_<id>` (or `--drive --finding-id <id>`)
  per finding. The trajectory push is rebase-on-reject (`:3060`) precisely so N parallel drives can
  share one corpus remote.

### 2.5 The intake machinery (the built-but-unused bridge)

`fix_pipeline.mjs` already contains a **mechanical** finding→drive intake (Stage 0), designed so
that *"H1 is 'pick a finding from the ratified queue'; everything downstream … is derived from the
queue row + the in-repo audit file. No hand-prep."* (`:850-853`):

- **`queue.jsonl`** — a ratified findings queue, one JSON row per finding, read by `queueRow`
  (`:854`). **⚠ This file does not exist in the repo** — the queue is empty.
- **`specFromRow(row, opt)`** (`:815`) — builds a spec from a queue row:
  `id ← row.finding_id`, `bugSite ← row.location`, `goalCondition ← row.goal_condition`,
  `changeIdPrefix ← fix-${id.toLowerCase()}`.
- **`auditTableRow(auditText, findingId)`** (`:866`) — locates a finding's row in an audit
  markdown by **parsing the header and mapping column *name* → index** (`:874-887`), so it handles
  the per-repo column-order variance (flashcore/DocInsight/PrimordialEncounters/pytest-fixer all
  differ). Exact-id match (`F16 ≠ F169`).
- **`materializeFinding`** (`:978`) — finding-id → `{brief, spec, worktree}`, all mechanical
  (`--intake` / `--drive --finding-id <id>`, `:6032`).

> **The gap is data, not code.** The transport reads a `queue.jsonl` that no one has written for
> either forensic corpus. Producing that file (§6) is the core of "driving the audits through."

---

## 3. The audit corpus — what feeds the pipeline

Two corpora, both produced by the same 5-stage forensic pipeline, keyed differently:

| Corpus | Subject | Raw → distinct | Plan | Finding key |
|---|---|---|---|---|
| `aiv-protocol/docs/audits/2026-06-18-forensic/` | `aiv-protocol` (Python) | **251 → 147** (1 run, 4 falsify rounds) | **79 items P1–P79** | plan `links_to` → `F##` |
| `black-box/audit/` | "Black Box" (TS/SQL) | **1312 → 1064** (opus 758 + sonnet 554) | **188 items** | plan item id **==** `F##` |

### 3.1 Finding schema

Raw findings (`aiv-protocol/.../raw/stage2.json.md`, `F1`–`F251`, contiguous) and the parseable
markdown table (`02-static-audit.md`, header `| ID | Sev | Status | Location | Class | Evidence |`)
carry the same fields:
```json
{ "id": "F43",
  "title": "pre-commit exception handler returns True — enforcement bypassed",
  "location": "src/aiv/hooks/pre_commit.py:212-214",
  "class": "error-handling", "severity": "critical",
  "evidence": "_validate_packet wraps the entire subprocess invocation in a bare `except Exception` and returns True on any error …",
  "intent_mismatch": true, "status": "verified", "runtime_confirmed": true }
```
The deduplicated view (`raw/distinct-issues.json.md`, 147 clusters) has a *different* schema —
`{ sig, severity, class, title, location, ids:[F##,…], n }` — clusters, with **no scalar id**
(only `sig` + member `ids[]`).

> **Only `id` (`F##`) is a usable drive key.** The friendly `C1/C2/H1…H18` labels exist **only in
> the human-written `FINDINGS.md`**, not in any JSON. The distinct clusters must synthesize an id
> (a representative `F##` or a slug of `sig`) to become a drive.

### 3.2 Severity and the criticals/highs

`aiv-protocol`, 251 raw → 147 distinct (`FINDINGS.md:25-32`):

| Severity | Raw | Distinct |
|---|---:|---:|
| Critical | 2 | **2** |
| High | 36 | **21** |
| Medium | 108 | 66 |
| Low | 90 | 53 |
| Info | 15 | 5 |

- **C1 / F43** — pre-commit `except Exception: return True` → the central gate **fails open**
  (`src/aiv/hooks/pre_commit.py:212-214`).
- **C2 / F96,F97,F98** — husky bash vs Python hook vs CLI **disagree on what a packet is** →
  bypass gaps across three enforcement surfaces.
- **Highs** (21 distinct clusters) — H1 path-traversal in packet resolution (F14,F83,F146,F197),
  H2 SSRF in link validation (two clusters), H3 R-tier rubric drift, H4 `aiv close` commits with
  `--no-verify`, H5 anti-cheat blanket-clear, plus H6–H18 (pagination, silent-except, fabricated
  claims, dead code, `or`-vs-`and` assertion bugs). Only C1/C2/H1–H5 were independently
  re-verified against source (`FINDINGS.md:45-54`); H6–H18 are audit-asserted / runtime-confirmed.

> **The headline result the audit itself flags:** *the verification tool's own enforcement contains
> the class of defect AIV exists to prevent* (fail-open gate, pattern drift). Driving these fixes is
> dogfooding in the strongest sense.

### 3.3 The remediation plan = the actionable, deduplicated unit

`aiv-protocol/.../05-plan.md` — **79 items**, table (`| ID | Change | Links | Location |
Verification | Depends |`) synchronized with a `## Machine-checkable data` JSON block (`:92+`).
Each item:
```json
{ "id": "P16",
  "change": "Make packet validation fail CLOSED: on any infrastructure error in _validate_packet, return False (block) or raise, instead of `except Exception: … return True`.",
  "links_to": "F43,F233",
  "location": "src/aiv/hooks/pre_commit.py:212-214",
  "verification": "Unit test: a forced exception inside _validate_packet causes main() to block the commit (non-zero exit), not pass.",
  "depends_on": "" }
```
- **Dependency-ordered and security-first.** 12/79 items carry `depends_on`; the order is
  topologically valid; the front of the plan is P1 (tier map), P3 (pattern-drift / C2), P4
  (traversal / H1), P5 (SSRF / H2), P16 (fail-closed / C1).
- **`links_to` is the finding join** (comma-separated `F##`, 78/79 items; the lone exception is
  P79 → `goal:quine`). One plan item fans out to many raw findings — this is where the 251→147→79
  deduplication is captured.
- **`verification` is the oracle seed** — a concrete acceptance test per item. This is the single
  most valuable asset for driving this corpus (see §6).

The black-box plan is even more drive-ready: **172 of its 188 items are keyed by a bare `F##`**
(`"id":"F1","links_to":"F1"`), so `drive_id = item.id.toLowerCase()` is the identity map — which
is exactly why the two existing forensic drives are named `fix-theirs-f20` / `fix-theirs-f316`.

### 3.4 The `.dedup` cross-run layer — and why iteration unit matters

`black-box/audit/.dedup/` compares **two independent audit runs** (opus 758 vs sonnet "theirs" 554)
with three LLM-judge passes (`judge2.mjs` cross-run match; `judge_within.mjs` within-run dedup),
calibrated against hand-labeled ground truth (**14/14** cross, **10/10** within). Result
(`02-static-audit.MERGED.md:7-11`): 1312 raw → **1064 distinct**, **123 confirmed by both models**,
567 opus-only + 374 sonnet-only leads. Cross-run confirmation is only **~21–26%**
(`CROSS-RUN-COMPARISON.md:9-15`).

> **Two consequences for driving:**
> 1. **A single audit run is stochastic** — only ~1 in 5 findings reproduces across models. The
>    pipeline's `verify-finding` gate (REFUTED → exit 5) is the built-in defense: it won't drive a
>    finding that doesn't reproduce (as happened for the REFUTED `pe-f998-cal` probe).
> 2. **Raw ≠ distinct.** Iterating raw findings drives the same bug up to 10× (the SSRF is F19,
>    F202, F90, F151, F203, F66, …). **Iterate the plan item / distinct cluster, not the raw list.**

---

## 4. Current state — what has actually been driven

From the 36-drive training corpus (`corpus_review.py`: 36 drives, 1517 records, ~$288 agent cost):

- **Forensic-corpus coverage: 2 / 36 drives**, both black-box sonnet-run findings
  (`fix-theirs-f20`, `fix-theirs-f316`), **neither terminal** (f20 stalled in the back-half at
  pr-summary; f316 front-half at prove-it). **The `aiv-protocol` self-audit: 0 drives.**
- **The other 34 drives are external/first-party projects** — the pipeline was hardened on
  PrimordialEncounters (13), PromptVerge (6), Pytest-Error-Fixing-Framework (3), flashcore (3),
  cultivation-os (3), mastery-engine (2), plus biosystems / DocInsight / RNA_PREDICT / stanford-cs336.
- **Outcomes:** 12 drives converged to `awaiting-H2` (open PR, human merge pending); **0 merged,
  0 rejected** at manifest level; 24 have no terminal (≈9 early-stalls, ≈8 held-out
  verify-finding/test-quality eval probes, ≈7 reached back-half without a terminal label).
- **Bottleneck = `design-tests`** (53 FAIL vs 35 PASS across the corpus — most failures of any
  stage). *"writing RED tests that satisfy the gate is where the agent fails most and burns the
  most time."* (`analysis/2026-06-21-corpus-review.md`).
- **The oracle-driven approach is validated.** The external-oracle pilot (biosystems #13) converged
  **11/11 contract items, CI green**, full trajectory + retro captured — *"the new
  'agent-can't-author-its-own-oracle' stress test passed its first full run."* This is the exact
  pattern the `aiv-protocol` corpus needs.
- **Recurring harness gaps** (from ≥2 retros each): missing `.aiv-workflow.yml` (skills silently
  default `branch.base=origin/main` — since fixed); thin reviewer-lane env (`gh`/`ruff`/`mypy`
  missing → dropped PR comments); SHA re-pinning after mid-run rebase; R-tier not declared in plan
  §0; `prove-it` accepting any green artifact regardless of coverage scope.

---

## 5. The gaps between the corpus and the pipeline

Ordered by how much they block a corpus drive:

1. **No `queue.jsonl` (the intake queue is empty).** *Blocking.* Neither corpus is ratified for
   driving. Fix: emit one namespaced row per plan item (§6.1).
2. **No per-finding `goalCondition` oracle.** *Blocking, but largely pre-solved for `aiv-protocol`.*
   The 79 plan items' `verification` field is a ready oracle seed; black-box items likewise carry a
   `verification` command. External corpora without this need per-finding oracle authoring — the
   least-automatable step.
3. **Drive-id namespace collision.** *Correctness.* `F43` = *critical fail-open* in `aiv-protocol`
   but a *low logic bug* in black-box. A pooled `f43` drive namespace would collide — prefix drive
   ids per corpus (`aiv-f43` vs `bb-f43`).
4. **Raw-vs-distinct over-generation.** *Efficiency/correctness.* Iterate the 79 plan items (or 147
   distinct clusters), never the 251 raw findings.
5. **Self-referential driving risk (specific to `aiv-protocol`).** *Care required.* The pipeline
   commits via the target repo's own `aiv commit` / `aiv close` hooks — and several findings *are*
   those hooks. Fixing C1 (fail-open) or C2 (pattern drift) changes the very gate the drive runs
   under. Drive on a worktree, respect `depends_on`, and expect the gate's behavior to shift as
   fixes land.
6. **`design-tests` throughput.** *Cost/time.* Budget for the known bottleneck; prefer findings
   whose oracle already exists (a real RED test) so `design-tests` *adopts* rather than authors.

Non-gaps worth noting: the `aiv-protocol` `02-static-audit.md` is already a clean parseable table
(`auditTableRow` handles it as-is); `aiv-protocol` is already AIV-ified (it *is* the protocol), so
the packet machinery works out of the box — it is the ideal dogfood target.

---

## 6. Runbook — driving the `aiv-protocol` forensic corpus

Concrete steps to take the 147-finding / 79-item corpus from "audited" to "driven." This adapts
`DRAFTING-DRIVES.md` from one drive to the whole corpus.

### 6.1 Emit a ratified, namespaced `queue.jsonl` from the plan (not the raw findings)

Iterate the **79 plan items** (deduplicated, dependency-ordered). One row per item:
```jsonl
{"finding_id":"aiv-p16","repo":"Black-Box-Research-Labs/aiv-protocol","location":"src/aiv/hooks/pre_commit.py:212-214","goal_condition":"pytest tests/unit/test_pre_commit_failclosed.py -q  # exit 0","category":"bug","links_to":"F43,F233","depends_on":""}
{"finding_id":"aiv-p3","repo":"Black-Box-Research-Labs/aiv-protocol","location":".husky/pre-commit:61","goal_condition":"pytest tests/integration/test_hook_parity.py -q  # exit 0","category":"bug","links_to":"F96,F97,F98,F210,F211","depends_on":"aiv-p2"}
```
- `finding_id` = **namespaced** plan id (`aiv-p##`) to avoid the black-box `F##` collision.
- `goal_condition` = derived from the plan's `verification` field (see §6.2).
- `location`, `links_to`, `depends_on` = copied straight from `05-plan.md`.
- Place it at `orchestration/queue.jsonl` (where `queueRow` reads, `:855`).

### 6.2 Turn each `verification` string into a real oracle

The plan's `verification` field is a *description* of the acceptance test — the oracle must be a
**runnable command that is RED at base and GREEN after the fix**. Per `DRAFTING-DRIVES.md`, this is
"the whole game," and for `aiv-protocol` most of the work is done:
- **Security findings** (P4 traversal, P5 SSRF, P16 fail-closed, P3 parity) → the oracle is a test
  that the *exploit is rejected* / the gate *blocks*. These are strong oracles: the malicious input
  is external truth the agent can't weaken.
- **Correctness findings** → the plan's `verification` already names the assertion (e.g. F1's `+++`
  line-counting bug → a test on the known input/output).
- **Author the RED test at base first**, then let `design-tests` *adopt* it (it "adopts, doesn't
  duplicate" when the oracle exists — sidestepping the §4 bottleneck).

> **Worked example already on this branch.** Commit `55e1979`
> (`tests/unit/test_pre_commit_failclosed.py` + its verification packet) is exactly the P16/F43
> oracle: it pins the gate fail-closed on a content-invalid packet. That test *is* the
> `goalCondition` for the C1 drive — proof this step is tractable.

### 6.3 Bind the target (`.aiv-workflow.yml`)

Point the skills at the real runner (a missing config was the #1 recurring corpus failure):
```yaml
branch: { base: origin/main, install_cmd: "pip install -e '.[dev]'" }   # aiv-protocol uses pyproject.toml
ci:     { local_replica_cmd: "pytest -q", test_cmd: "pytest -q" }
```

### 6.4 Drive, security-first, in dependency order

Findings are bug fixes (the defect exists at base), so no stub-at-baseline is needed — the SEAM
reverts the fix and gets RED for free. Fan out one drive per item, honoring `depends_on`:
```bash
export FIX_TRAINDATA_DIR=/path/to/aiv-polymath-traindata     # writable clone
export GIT_TOKEN=ghp_...
# Priority order = plan order: P16/F43 (C1) → P3/F96 (C2) → P4 (H1) → P5 (H2) → …
for item in aiv-p16 aiv-p3 aiv-p4 aiv-p5 … ; do
  node orchestration/src/fix_pipeline.mjs --drive --finding-id "$item" \
       --cwd /path/to/aiv-protocol-worktree-$item
  #   (materializeFinding builds spec+brief+worktree from the queue row + 02-static-audit.md)
done
# For long runs, wrap each in the resumable supervisor:
#   bash orchestration/src/drive_supervisor.sh spec_aiv-p16.json log_aiv-p16.txt
```
- `intentSource` for each spec should point at
  `docs/audits/2026-06-18-forensic/02-static-audit.md` + the finding's `intentLine` (the Class-E
  immutable intent). `auditTableRow` parses that table directly.
- Each drive parks at `awaiting-H2` with an open PR, an `aiv/<changeIdPrefix>` provenance tag, and
  a full trajectory in `drives/aiv-p##/`. **A human performs the merge** — the pipeline never does.

### 6.5 Validate before spending tokens, and watch the known failure modes

- `--dry-run` and `--seam-check --spec <f>.json --cwd <wt>` confirm the RED@base/GREEN@HEAD seam
  with zero API cost — run these on the first few specs before a batch.
- Expect `design-tests` to be the slowest/failing-most stage; front-loading real oracles (§6.2) is
  the mitigation.
- Because C1/C2 fixes change the repo's own hooks, drive them on isolated worktrees and re-verify
  the gate after each lands.

---

## 7. Recommendations

1. **Build the `queue.jsonl` generator** — a small script (natural home:
   `aiv-workflow/orchestration/` or `black-box/audit/`) that reads `05-plan.md`'s machine JSON and
   emits namespaced rows with `goal_condition` seeded from `verification`. This is the one missing
   mechanical piece; everything downstream already exists.
2. **Drive the two criticals first as a proof run** — P16/F43 (oracle already committed here) and
   P3/F96. Success yields the first `aiv-protocol` self-audit trajectories and closes the
   dogfooding loop the audit's headline calls for.
3. **Iterate plan items, namespace drive ids, and lean on `verify-finding`** to auto-drop the
   non-reproducing tail (expected, given ~21–26% cross-run reproducibility).
4. **Treat `verification` fields as first-class oracles** in the audit format going forward — the
   forensic pipeline should emit a runnable oracle per plan item, not just a prose acceptance
   description, so the fix pipeline can consume the corpus with zero hand-authoring.

---

*Sources: `aiv-workflow/orchestration/src/fix_pipeline.mjs`, `aiv-workflow/docs/{PIPELINE,DRAFTING-DRIVES}.md`,
`aiv-workflow/skills/*`, `aiv-protocol/docs/audits/2026-06-18-forensic/*`, `black-box/audit/*`,
`aiv-polymath-traindata/{README.md,drives/*,tools/corpus_review.py,analysis/*}`. Coverage figures from a
live `corpus_review.py` run over 36 drives.*
