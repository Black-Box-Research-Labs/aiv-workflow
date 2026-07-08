# orchestration/ — the fix pipeline

A **deterministic harness** (a program, not a chat agent) that drives one audit **finding → PR** through the
aiv-workflow skills' 14 stages, gating every transition on a schema-valid machine block and HALTing
fail-closed when a gate fails. There are exactly two human touchpoints: **H1** (the finding, in) and **H2**
(judge the evidence + merge, out). Agents never merge.

**Why a program and not one big prompt:** a single agent context can rationalize skipping a stage and
structurally cannot do separation-of-duties. Here the orchestrator is code, and each stage is a fresh,
isolated `claude -p` subagent that sees only the prior stage's artifacts — never its reasoning. A weaker
driver can only fail to emit a valid block (→ fail-closed HALT); it cannot false-pass a gate. That is what
makes the pipeline **model-agnostic** and safe to run on cheap or free models.

## Layout

- `fix_pipeline.mjs` — the driver (start here). `drive_supervisor.sh` — detached, auto-resuming runner.
- `../skills/` — the aiv-workflow skills the driver consumes (single source of truth).
- `drivers/` — run the pipeline on a non-Claude model (the OpenRouter shim + model-vetting `probes/`).
- `bake/` — the per-stage benchmark rig (F017 worked example + fixtures).
- `docs/` — operator guide, dispatch playbook, machine-block schemas. `docs/design/` — design rationale.
- `research/` — the weak-model technique report + best-of-N design.

## Run it

```bash
node fix_pipeline.mjs --selftest    # zero-API: gates, validators, coercion, extraction, state (0 failed is the gate)
node fix_pipeline.mjs --dry-run     # zero-API: the full 14-stage flow + both loops + a SEAM-HALT check
node fix_pipeline.mjs --preflight   # one cheap real `claude -p` — proves auth + tool-use + file handoff
node fix_pipeline.mjs --drive --spec <spec.json>   # THE SPINE: auto-chain H1->H2 with checkpoint/resume
```

`--selftest` grows as fixes land; **0 failed is the gate** (run it for the current count). For long runs use
`drive_supervisor.sh <spec.json> <log>` — it self-detaches and auto-resumes on the atomic `state.json`
cursor, stopping only on a fail-closed HALT or SPINE COMPLETE.

## The spec

A drive is parameterized by a per-finding spec: `id`, `repo`, base branch, change prefix, the cited intent
source, the bug site, and the **`goalCondition`** — the machine-checkable oracle that decides "fixed."
`bake/specs/spec_f017_template.json` is a complete worked example; hand-author one, or generate specs from
your own findings queue. `LIVE_STAGES` tasks carry no finding literals — everything is `{{SPEC}}`
placeholders resolved by `applySpec`, so the spec is the only per-finding input.

## The two convergence loops

- **Loop #1 (plan):** `planConverge` iterates plan ⟷ check-drift until the plan gate passes; a repeated
  hard-stop signature is a no-progress HALT.
- **Loop #2 (back-half):** `backHalfConverge` repeats {reconcile → cr-review → aiv-audit → pr-summary →
  poll-ci → or-review} until a full round changes nothing AND CI is green AND or-review PASSes — stable for
  `STABLE_N` rounds at the same head. An identical unresolved state two rounds running is an oscillation HALT.

**Robustness is inherited** from a sibling forensic audit pipeline (many audits): tolerant JSON + machine-
block extraction, enum-drift coercion, recursive validation, durable checkpoint/resume, durable HALT,
outage≠pass gates, and HALT exit codes (`3`=HALT, `4`=gate-fail, `5`=finding-refuted). The line-by-line
carry-forward audit is `docs/design/LEARNINGS_CARRYFORWARD.md`.

## Running on a non-Claude model

Every stage is spawned as `claude -p ...` and gated on a schema-valid block — never on the model's prose or
identity — so the driver is swappable behind the `claude` command with zero pipeline changes. `drivers/openrouter/`
ships a `claude -p` drop-in shim that routes spawns to OpenRouter, validated end-to-end on a non-Claude model
through the check-drift + aiv-audit gates and surviving a container restart. See `drivers/openrouter/README.md`
for the swap mechanism and its two non-obvious requirements (`NODE_USE_ENV_PROXY=1`, honest `GIT_AUTHOR_*`
provenance), and `drivers/openrouter/probes/` to vet a candidate model before a real drive.

## Where to read next

- `docs/OPERATOR.md` — set up and operate a drive (prereqs, dispatch, proof-strength triage).
- `docs/MACHINE_BLOCK_SCHEMAS.md` — the gate-contract schemas the orchestrator validates.
- `docs/design/TRACE_LOOP.md` — the operating method (VERIFY-BEFORE-CLAIM + the goal template).
- `bake/` — the per-stage benchmark rig: an F017 worked example (brief, plan, contract) + per-stage runners.
