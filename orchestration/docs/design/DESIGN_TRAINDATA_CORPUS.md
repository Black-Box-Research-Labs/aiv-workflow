# DESIGN — Training-data corpus (full-trajectory capture to distill cheaper drivers)

> **Status:** shipped and selftested in `fix_pipeline.mjs`. Capture is **off by default** and turns on when you
> set **`FIX_TRAINDATA_DIR`** to a clone of a repo **you** control — point it at your OWN training-data store.
> When unset, selftest / dry-run / normal drives are completely unaffected (no behavior change).
>
> **What ships:** `scrubText` (STRICT drop-on-secret + PII/path redaction, noreply allowlist), `recordStep`
> (scrub then append one JSONL line per attempt, non-fatal), `traindataPush` (commit+push at each stage
> boundary, `pull --rebase` first so concurrent writers don't drop commits, non-fatal), and
> `writeTraindataManifest` (the terminal outcome label). Capture is hooked at every spawned attempt — front-half
> (`runLiveStage`) AND back-half fix-loops (cr-review, aiv-audit, pr-summary, poll-ci, memory-retro) — so failed
> goal-loop iterations and HALTs (the negative examples) are recorded, not just the successful final attempt.
>
> HALT durability is best-effort: a container death mid-HALT before any push loses the current stage's steps.

---

## 0. Why this exists (the reframe)

The goal: use the pipeline's own outputs to train cheaper models to drive it, instead of always relying on a
frontier model. This inverts the retention value axis. The packet + evidence are the **outputs/labels**;
a model that *drives the pipeline* must learn the **trajectory** — finding → launch-brief → plan → gate
verdicts → design-tests → write-code → prove-it → back-half convergence. That trajectory IS the launch-briefs,
plans, and verdicts the retention draft was about to discard, PLUS the per-stage `(prompt → completion)` pairs
and the **failed** goal-loop iterations / HALT-fix-resume cycles (the negative examples).

**The bug this design closes:** today the only per-stage capture is `WORK/last_stage_streams.txt` — the LAST
attempt only, overwritten each spawn, in gitignored ephemeral `WORK` (the container is reclaimed). item-6 +
the retention plan would route briefs/plans/verdicts to the same `WORK` void. So the training signal is being
generated and then destroyed on every drive. This design captures it durably instead.

---

## 1. Two principles that shape the design (both already earned)

1. **Deterministic-authority scoping (#29/#33/#34) already defines the MINIMAL model surface.** A cheap model
   does NOT need to learn the deterministic gates (`aiv check`, CI, `GATE_FN`, SHA/shape/theater) — those stay
   code. It only needs the **agent's genuine lane**: the EXEC stages' artifact/code generation and the gate
   stages' *semantic* judgment (Class-E intent alignment, claim↔evidence correspondence). So each captured
   step is tagged `target_lane: "agent" | "deterministic"` — only `agent`-lane steps are distillation targets;
   `deterministic` re-derivations are captured for context but are NOT training labels. Pushing more judgment
   into deterministic code (the ongoing direction) directly shrinks the model's job.
2. **The pipeline is the corpus generator AND the eval harness.** Each stage is an isolated `claude -p` with a
   deterministic gate on its output. So a candidate cheap model can be dropped into ONE stage and scored by its
   **gate-pass / convergence rate vs Claude on held-out findings** — a falsifiable per-stage metric, not a
   vibe. This is the eval half; the corpus is the train half. Both fall out of the same per-step records.

---

## 2. What to capture — the schema

One JSONL record per **step** (a single `spawnOnce`), the atomic unit. A drive = an ordered stream of steps.

```jsonc
{
  "drive_id": "myproj-f042",           // = spec.changeIdPrefix; joins to the aiv/<drive_id> provenance tag
  "repo": "<owner>/<repo>",
  "finding_id": "f042",
  "stage": "write-code",
  "attempt": 2,                         // goal-loop iteration (attempt>1 ⇒ a prior attempt failed = negative ex.)
  "ts": "2026-06-20T06:01:00Z",
  "model": "claude-sonnet-4-6",         // who produced this (so distilled-model runs are distinguishable)
  "target_lane": "agent",              // agent-judgment (a training target) vs deterministic (context only)
  "input": {
    "prompt": "<the full stage prompt: skill + finding + task + injected sections>",
    "feedback": "<the prior-attempt failure feedback that conditioned THIS attempt, or null>",
    "repo_state_ref": "<git sha of the worktree HEAD at spawn>"   // reproducibility, not the whole tree
  },
  "output": {
    "completion": "<env.result — the agent's final text>",
    "commits": ["<sha> <subject>", ...],          // what landed on the branch this step
    "files_touched": ["src/scheduler.py", ...]
  },
  "outcome": {                          // the LABEL / reward signal
    "gate": "PASS|FAIL|null",          // gate stages: GATE_FN result; code stages: verifyCmd green?
    "gate_detail": "<machine block / verifyCmd tail / oracle-guard miss>",
    "advanced": true,                   // did the step make progress (commits / gate closer)?
    "transient_retries": 0
  },
  "telemetry": { "cost_usd": 0.42, "num_turns": 7, "is_error": false, "duration_ms": 84000 }
}
```

Plus one **drive manifest** per drive (`<drive_id>/manifest.json`): finding, repo, base/substantive SHAs, the
`aiv/<drive_id>` tag, the ordered stage list, totals (cost/turns/wall-clock), and the **terminal outcome label**
— `awaiting-H2 | merged | rejected | halted:<stage>` (the outcome reward; backfilled from the PR/merge state).

**The tag is the join key.** `aiv/<drive_id>` (#36) pins the exact pre-merge DAG; the manifest references it; a
harvester walks `refs/tags/aiv/*` to enumerate every labeled trajectory against its immutable code state.

> **As-built note (v1.1).** The output half is `output.completion` plus, when completion is empty,
> `output.artifacts {commits, diffstat, machine_block}` (#41) — the design's `commits`/`files_touched` fields are
> realized as `artifacts`. `drive_id` is **lowercased** (#61). The `manifest.json` carries `pr_url` (#43) and a
> `source` field: absent/`"drive-time"` = written by the live pipeline at SPINE-COMPLETE; `"post_hoc_reconstruction"`
> = reconstructed after a HALT-then-manual-converge (filter these out for authentic drive-time training). A drive
> that HALTed before the provenance-tag stage has `provenance_tag: null` (no tag was created).

---

## 3. Where it lives — a dedicated repo

Use a dedicated repo (cleanest separation; keeps the corpus out of every product repo). Create it, make it
reachable from the drive environment via `GIT_TOKEN`, and point `FIX_TRAINDATA_DIR` at a clone. Layout:

```
aiv-traindata/
  drives/<drive_id>/steps.jsonl        # the per-step stream (append-only)
  drives/<drive_id>/manifest.json      # the drive summary + terminal label
  README.md                            # schema + provenance-tag join doc
  scrub/DENYLIST.md                    # PII/secret patterns (the scrub contract)
```

**Size caveat (flagged):** full trajectories grow unbounded (every prompt/completion, incl. failures, across
hundreds of drives). git is the only durable sink reachable from the ephemeral drive container, so it's the
pragmatic v1, but: (a) store completions as text, never blobs; (b) keep `repo_state_ref` as a SHA, never the
tree; (c) plan a migration path to an object store / the external-drive archive once volume warrants. Not a v1
blocker, but do not let trajectories carry large pasted file contents — reference by SHA + path.

---

## 4. The capture seam in `fix_pipeline.mjs`

A single sink abstraction, **off by default** (safe — no behavior change unless enabled), enabled per-drive:

- `const TRAINDATA = process.env.FIX_TRAINDATA_DIR || null;` — a path to a clone of the dedicated repo. Null ⇒
  capture is a no-op (selftest/dry-run/un-configured drives are unaffected).
- `function recordStep(spec, rec)` — scrub (§5) then append a JSONL line to `<TRAINDATA>/drives/<id>/steps.jsonl`.
  Pure-ish (filesystem append); selftestable on the scrub + record-shape with a temp dir.
- **Hook point: `spawnOnce` (line ~1488–1516).** It already has `prompt`, `env`, `r` (streams), and the goal
  loop already has `feedback`, `n` commits, `oracleGuardLive`, the gate `out` JSON, `verifyCmd` result. So
  `spawnOnce` returns the input half; the goal-loop / gate path assembles the `outcome` half and calls
  `recordStep`. This captures EVERY attempt (not just the last), which is the negative-example data.
- **Push cadence:** write locally during the drive; `git -C $TRAINDATA add/commit/push` at **stage boundaries**
  and **on HALT** (a HALT trajectory is the highest-value negative example — must survive the container being
  reclaimed). Reuse the exponential-backoff push helper. Commits to the corpus bypass any AIV hook (data, not code).
- **Terminal manifest + outcome backfill:** `memoryRetro` (already the terminal stage) writes `manifest.json`
  with `awaiting-H2`; a later sweep (or the #35 PR-freshness check) backfills `merged|rejected` from the PR state.

This is ~one helper + ~3 call sites + the manifest write — small, localized, and gated behind `FIX_TRAINDATA_DIR`.

---

## 5. PII/secret scrub — a TRAINING-SAFETY gate, not just hygiene

Capturing turns INVARIANT #6 (don't exfiltrate PII/PHI/secrets into artifacts) into a memorization risk: a
distilled model can regurgitate anything in the corpus. So `recordStep` runs a scrub BEFORE any write:
- denylist regex (API keys, tokens, `*_SECRET`, `*_KEY=`, emails other than the noreply identities, `/Volumes/...`
  user paths, home dirs) → redact to `[REDACTED:<kind>]`.
- a secret-scanner pass (e.g. gitleaks-style patterns) on each completion/prompt.
- a hard FAIL-CLOSED: if a high-confidence secret is detected, drop the step's raw text and record a marker
  (`"redacted": true`) rather than committing the secret. Better a hole in the corpus than a leaked key in a model.
The scrub contract lives in `scrub/DENYLIST.md` and is selftested with positive/negative fixtures.

---

## 6. Train/eval rollout (the payoff, sequenced)

1. **Capture** (this design) → accumulate trajectories across the next N drives. Done-signal: one drive's full
   trajectory (all stages, all attempts, manifest, scrubbed) is in `aiv-traindata` and joins to its `aiv/` tag.
2. **Eval harness first** (cheap, falsifiable): pick the most TEMPLATED stage (launch-brief or pr-summary), run
   a candidate cheap model on held-out findings, measure gate-pass / convergence vs Claude. Done-signal: a
   number (e.g. "cheap model passes pr-summary's deterministic gate on 18/20 held-out findings").
3. **Distill templated stages first**, keep Claude on write-code + the judgment lanes; promote a stage to the
   cheap model only when its measured gate-pass clears a threshold. The opus/sonnet/haiku tiering is the proto.
4. **Process-reward / RL later** (uses the per-step gate labels + terminal outcome) — out of v1 scope.

---

## 7. Sequencing & dependencies (what this unblocks)

- **This is the dependency for "move scaffolding off main."** Until the corpus store exists, the retention
  flip (route launch-briefs/plans/verdicts off main) would dump them into the ephemeral `WORK` void. Order:
  (1) build corpus store + capture seam (this doc) → (2) point item-6's verdict writes + briefs/plans at the
  corpus → (3) flip retention so `main` keeps proof only.
- **Reuses #36's tag** as the corpus index (already shipped + proven on #32).
- **Independent of** the finding-KIND frontier and the full-suite-per-aiv-commit cost (#1) — but note: cheaper
  drivers + targeted-suite (#1) are the same "make it scale" workstream.

---

## 8. Open decisions (for the build, after this design is approved)

1. **Repo name** — `aiv-traindata` vs `polymath-traindata` vs other; and create + add to scope.
2. **Push cadence** — every stage (more git churn, max durability) vs every 3 stages + on-HALT (less churn).
3. **Scrub strictness** — redact-and-keep vs drop-the-step on any secret hit (recommend drop-on-high-confidence).
4. **Dataset export format** — keep raw JSONL (flexible) and add an export script for SFT (`{prompt, completion}`)
   / RL (`{state, action, reward}`) later, vs commit to one now (recommend raw JSONL now, export later).

---

## 9. Falsifiable done-signal for v1 (the capture build)

Drive ONE finding with `FIX_TRAINDATA_DIR` set; afterward `aiv-traindata` contains that drive's
`steps.jsonl` (one record per attempt across all stages, including any failed goal-loop attempts),
a `manifest.json` with the terminal label + the `aiv/<drive_id>` tag, all scrubbed (verified: inject a
fake secret into a finding and confirm it is `[REDACTED]` in the corpus, not stored raw). If a failed
attempt or a HALT is NOT captured, v1 is not done — the negative examples are the point.
