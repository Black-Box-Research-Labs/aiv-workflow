# TRACE LOOP — the fix-pipeline observability loop (canonical, v2 post-campaign)

The operating method for grinding the pipeline against any driver (1B locals or nemotron). v1 ran the
2026-07-06 campaign (35 fixes #140-#174); v2 bakes in every discipline clause that session's failures taught.
Invoke as: `/loop <the LOOP PROMPT below>` (dynamic mode, 1200s ticks = the operator-set 20-minute cadence). Pair with a /goal whose
condition names MEASURABLE artifacts (see GOAL TEMPLATE).

## ⛔ UNCHANGEABLE PREAMBLE — prepend this block VERBATIM to EVERY /loop prompt; never edit it, never drop it, never summarize it

> **VERIFY-BEFORE-CLAIM — this is the ONE mistake that recurs every phase, in the model AND in the operator
> of the harness.** Every factual assertion about external state — repo code, a file's contents, a GitHub
> comment / PR, a gate's count, a stage outcome, or WHICH file/line/comment/item something is — must be
> produced by a tool call **in the current turn**, not recalled, assumed, or copied from a secondary source.
> Secondary sources are HYPOTHESES, never facts: a harness log one-liner (`invalid machine block`,
> `coderabbit_actionable=1`, `SIGKILL`, `shape FAIL`, `NON-COMPLIANT`), a bot / reviewer comment (CodeRabbit
> "still uses getattr"), an aggregate count, a prior turn's belief, or your OWN earlier summary. Before you
> write "X is the case", answer: *which command did I run THIS turn that shows X?* — if none, run it first.
> Before you characterize WHICH file/line/comment/artifact something is, OPEN it; never infer it from a label,
> a severity tag, or a number. For a stage diagnosis specifically, the primary source is the model's actual
> output — `steps.jsonl` `output.tool_trace` (#188), `fix/.work/last_<stage>.txt`, the `stage_*` gate file, or
> the block the model actually wrote — cite the specific turn / tool-call / line it rests on.
>
> Scars — each a confident claim that collapsed the instant the primary source was opened (do not add a 7th):
> (1) or-review "the model can't emit the 10-field schema" — the trace showed 50 real turns; the prompt's own
> example printed `"verdict":"PASS|WARN|FAIL"` and the model copied it (#189). (2) "the CodeRabbit 🟠 Major
> (label bug) is a real code signal blocking F004" — the file at line 217 already used `_particle_labels`; the
> bug was fixed; the claim came from the bot's stale comment, not the file. (3) "the counted comment IS that
> label bug — it's a false positive, just fix #126" — the actually-counted comment was a DIFFERENT 🟠 on the
> seam evidence file (a real seam-rigor issue), found only by querying the API; the "false positive" verdict
> was itself another unverified assertion. **NEVER** write "the model can't do X" / "weak-model wall" / "too
> complex" — unanimous cross-model failure is a harness gap (format / task-shape / prompt example / anchoring),
> proven by reading the turns, never asserted from a summary.
>
> You MAY customize everything BELOW this block per tick; this block is fixed. Whenever you are about to state
> a conclusion or propose a fix, STOP and ask: *primary source, this turn — or am I repeating a summary?*

## LOOP PROMPT (paste after /loop)

FIX-PIPELINE TRACE-ANALYSIS LOOP (stage-agnostic):
1. DISCOVER any live run (pgrep -f fix_pipeline.mjs) + the newest trace_*.jsonl (mtime). No hardcoded stage/pid.
2. DELTA: read only records added since the offsets in $BAKE_ROOT/trace_loop_state.json.
3. ANALYZE each turn's reasoning+tools vs the contract-gap taxonomy (did WE withhold / mislead / conflict?):
   repeated identical errors; hunting for referenced-but-undelivered files; interactive prompts headless;
   destructive git; env pollution; artifact-name invention; recreating persisted work; FS wandering; ignoring
   provided inputs. Distinguish model-weakness (slow/thorough on legitimate work) — that does not block.
4. INTERVENE EARLY: doom-loop or unrecoverable structural break => KILL + diagnose; never burn attempts/quota.
5. ON RUN EXIT: before/after vs the prior trace for the SAME stage; verify stage-exit criteria; AUDIT THE
   ARTIFACTS THEMSELVES (open them; RUN committed tests; check VALUES against ground truth) — never just the
   verdict/exit code.
6. RESCHEDULE 1200s (20 min — operator-set cadence) while a run is alive; stretch toward 1800s ONLY when a run is known-long and nothing can be audited sooner (ScheduleWakeup, prompt = this file's LOOP PROMPT + a one-line
   pointer to the CURRENT state records); stop when parked/complete or the operator ends the play.

## DISCIPLINE CLAUSES (each one is a scar; violating it cost real time in the campaign)

- NEVER conclude "the model can't do X" without reading its actual turns. Six such claims died this way
  (format/task-shape/prompt-size every time). Unanimous failure across models = harness gap, not capability.
- EXIT= LINES are the verdicts, never a wrapper script's $?. NEVER pipe a command whose exit code you consume
  (`| tail` struck 4x, including twice in freshly-written code).
- EXIT=0 is NOT proof. Six false-greens were caught ONLY by opening/running the committed artifact — including
  a fully self-consistent WRONG walk (fabricated oracle -> fix aligned to the wrong test -> seam held -> all
  green). Audit VALUES against the finding's own executed commands.
- Before any acceptance re-run: verify the input state is REPRESENTATIVE (bug present, no prior packets,
  branchCommits=0 vs the TRUE base ref, venv functional, aiv context closed, environment drift reverted) — not
  just that the process launches. REMOTE SYNC on full drives: force-push origin/<head> to match the reset local
  head — a diverged origin invites the model to pull/merge stale history (the F017-v5 failure). The checklist, not memory.
- Every failure mode gets TWO fixes: prevention (prompt/contract) AND deterministic recovery (detect/restore/
  fail-closed). Durable guarantees live in the state machine, never the prompt.
- One logical change per commit, comment cites the observed failure; selftest + targeted assertion before commit;
  push after the acceptance re-run passes.
- Bake-harness hygiene (the meta-tooling lessons): UNIQUE label per experiment case (shared labels overwrote
  logs + evidence between cases); runners must `exit $RC` (a trailing echo eats it); expect background waits to
  be harness-notified (launch nohup + audit on wake, don't block); unload Ollama models before git/heavy bash;
  local lanes own their worktrees, remote lanes own theirs.
- Model-capability boundary test: a cell is "capability" ONLY when (a) the actual turns were read, (b) the real
  gate ran, (c) every harness wall (prompt size / format / task shape / anchoring / grounding facts) was removed.
  The single boundary that survived all of that: newly generated grounded prose (no recorded fact to bind).

## GOAL TEMPLATE (pair with the loop via /goal)

`/goal` FEEDS A STOP-HOOK — an evaluator that gates session-end and reads ONLY this text, never the loop. So the
acceptance DISCIPLINE must live HERE, not be delegated to the loop: a thin goal ("spine complete + gates pass")
lets the session end on a band-aid, a skipped artifact audit, or a prevention-only fix. Keep the METHOD in the
loop (how to iterate); keep the OBJECTIVE + EXIT CRITERIA + DISCIPLINE in the goal (what "done, correctly" is).
(Earlier this template was compressed to three lines and the discipline moved into the loop — that WEAKENED the
hook; do not re-compress it.) Fill <SCOPE> = "the <STAGE> stage" for a bake, or "the <FINDING> drive to SPINE
COMPLETE" for a full walk; <DRIVER CLASS> = "1-2B local models" or "the free nemotron cascade".

"<SCOPE> runs to completion on <DRIVER CLASS> with zero errors; a before/after trace comparison proves each
bottleneck structurally resolved; every change committed individually with a convention comment; no
prompt-nudging or band-aids.
Stage-exit criteria (all three):
1. Terminal reached cleanly. UNGATED stages (launch-brief, plan, ground): run_end ok=true, no HALT/error/timeout.
   GATED stages (check-drift, or-review, aiv-audit, prove-it): the gate PASSES on a schema-valid verdict — 'the
   model ran' is NOT enough, the verdict must meet the gate predicate. A full drive terminates at the PR (H2)
   with a valid AIV v2.2 packet body; a REFUTED terminal (exit 5) is a SUCCESS, not a failure to fix.
2. The correct consumable artifact exists at the path the NEXT stage reads, with AUDITED content — open it, RUN
   the committed tests, check VALUES against the finding's own executed commands (right interpreter/venv/rootdir;
   numbers match claims; no fabricated oracle — a self-consistent WRONG walk once passed every gate). Not 'a file
   got written' — the RIGHT file, where the next stage looks, audited.
3. Every remaining inefficiency traces to model capability, not a harness-contract gap. Per wasted turn: did we
   withhold something it needs, tell it something wrong, or give conflicting instructions? If yes -> structural,
   fix it, it blocks the move. If the contract is correct and the model is just slow/thorough on legitimately-
   needed work -> model-weakness, does not block (a distillation/model-tier lever, not a harness fix). Before any
   acceptance re-run, verify the input state is REPRESENTATIVE of the bug (bug present, no prior packets,
   branchCommits=0 vs the TRUE base ref), not just that the process launches. Every failure mode gets TWO fixes:
   prevention (prompt/contract — lowers the probability the stochastic model misbehaves) AND deterministic
   recovery (the harness detects/restores/fails-closed — bounds the outcome); a prompt-only fix works against the
   architecture — durable guarantees live in the state machine, not the prompt."

## INFRASTRUCTURE (repo-persisted; export BAKE_ROOT=<working dir> first)

- orchestration/bake/bakeoff.sh — single-stage runner: stage, cascade, label, worktree, text_tools; sets
  FIX_WORK/FIX_SHIM_TRACE/FIX_MODEL_CASCADE per label; propagates the pipeline's real exit code.
- orchestration/bake/bake_stage.sh — per-stage bake runner (dt|wc|pi single stages, plan-conv loop, e2e
  5-stage chained walk vf->dt->tq->wc->pi); resets the worktree to each stage's precondition + injects canon.
- orchestration/bake/canon/ — F017 ground-truth preconditions (nemotron's brief/contract/plan) for regression bakes.
- orchestration/bake/specs/spec_f017_template.json — spec template (edit cwd per worktree).
- Production drives: drive_supervisor.sh (ceremony=build default, tracer on, exit 3/2/4 stop, 5 = refuted success).
- Observability: FIX_SHIM_TRACE jsonl (run_start/turn/run_end: prompt_len, reasoning, tool_execs, latency, usage)
  + WORK/last_stage_streams.txt + stage logs. The trace is the evidence base; read it before any conclusion.

## APPENDIX — v1 verbatim (Jul 5, the prompt that ran the campaign's first half)

```
/loop FIX-PIPELINE TRACE-ANALYSIS LOOP (stage-agnostic, runs for the whole walk):
1. DISCOVER: find any live pipeline run (pgrep -f "fix_pipeline.mjs") and the newest trace_*.jsonl in the scratchpad (mtime). No hardcoded stage/pid/file.
2. DELTA: read only trace records added since the last analyzed offset (persist offsets per trace file in scratchpad/trace_loop_state.json).
3. ANALYZE each new turn's reasoning + tool calls against the contract-gap taxonomy (did WE withhold/mislead/conflict?): repeated identical errors; hunting for files the contract references but never delivered; interactive prompts hanging headless; destructive git ops (reset/rebase/rm of history); environment pollution (installs outside .venv); artifact-name invention (variants of harness-owned names); recreating work that already persists; FS wandering outside the worktree; ignoring inputs that were provided. Distinguish from model-weakness (slow turns, redundant reads on legitimately-needed work) — that does not block.
4. INTERVENE EARLY: if the delta shows a doom-loop or a structural break the current contract cannot recover from, KILL the run immediately and diagnose — never let it burn remaining attempts/quota. Otherwise report notable signals briefly and let it run.
5. ON RUN EXIT: run the full observability loop (memory: fix-pipeline-observability-loop) — before/after vs the prior trace for the SAME stage; verify stage-exit criteria; AND for gated stages AUDIT THE EVIDENCE ARTIFACTS THEMSELVES (open the files: real tool output? right interpreter/venv? right rootdir? numbers match claims?), never just the verdict/manifest — a weak model self-reports PASS (prove-it ran its evidence on polluted system python; only an artifact audit caught it); then next fixes or next stage.
6. RESCHEDULE: pass THIS prompt (scratchpad/trace_loop_prompt.txt) back via ScheduleWakeup — 1200s (20 min, operator-set cadence) while a run is alive — the Monitor on the pipeline log covers urgent events between ticks, stop scheduling when the walk is parked/complete or the operator ends the play.
Clean-state rule for any acceptance re-run (before/after): verify git HEAD+status clean at the intended base, no stray untracked artifacts (packets/evidence/catalogs), aiv context closed, .venv intact, ENVIRONMENT drift reverted (packages a prior run installed outside the venv), and REMOTE SYNC: origin/<head-branch> force-pushed to match the reset local head (a diverged origin invites the model to pull/merge stale history — v5 failure). The checklist, not memory.
```
