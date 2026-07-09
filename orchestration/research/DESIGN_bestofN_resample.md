# DESIGN DRAFT — best-of-N resample fallback at aiv code stages (#99, proposed)

**Status:** APPLIED 2026-06-25 (commit 006329f) — wired into `runLiveStage`'s goal loop at the regression /
verifyCmd-stall / CAP halt points; opt-in on write-code + design-tests; `FIX_RESAMPLE_N` default 3; EXP-4
refinement baked in (vary approach, not temperature). Applied now because OBS-B (laguna/qwen daily-capped) made
gpt-oss the coder, and EXP-2b showed best-of-N lifts gpt-oss 60%->100%. selftest 269. Validate on the next live stall.

## Problem (evidence-grounded)
A weak free model sometimes can't converge a code stage via **self-repair** (re-running the same agent with
the gate's traceback fed back). Our goal loop currently HALTs on no-progress (the gate signature repeats).
But the R&D (`RND_LOG.md`) shows two complementary recovery levers, and we only use one:

- **Self-repair (EXP-3):** gpt-oss ordinal 70%→100% in **1 round**, +0 after. Most call-efficient *when the
  gate traceback is informative*. ✅ already our design.
- **Best-of-N + execution-select (EXP-2b):** 60%→100% by gate-selecting a fresh sample where greedy/repair
  failed. Works even when the failure is **opaque** (gate says fail, traceback doesn't guide a fix) — exactly
  the case where self-repair stalls and we currently just HALT.

**Gap:** when self-repair stalls, we HALT instead of trying a fresh independent sample. Best-of-N is the
missing fallback. Layered design (head-to-head conclusion): **repair first → resample on stall.**

## Algorithm
```
write-code/design-tests goal loop (existing):
  preStageRef = HEAD   # the design-tests output (RED tests committed); the clean pre-write-code base
  for attempt in 1..CAP:        # self-repair (existing): spawn → gate → feedback → retry
     ... if gate green: return success
     ... if goalStalled(prevSig, sig):                    # <-- HOOK HERE (currently: haltStage)
            if s.resampleFallback:
                result = bestOfNResample(...)
                if result.pass: return result             # a fresh sample passed the gate
            haltStage(...)                                 # fail-closed: no sample passed

bestOfNResample(preStageRef):                              # repair stalled -> try N fresh, independent
  for k in 1..RESAMPLE_N:
     git reset --hard preStageRef; git clean -fd          # clean slate (drop the stalled churn; keep gitignored plan)
     (echo y | aiv abandon) || true                        # reset any half-open aiv change context
     spawnOnce("FRESH RESAMPLE k/N: prior approaches stalled; implement the plan from a clean slate, vary approach")
     gate = evalGate()                                     # SAME regression + verifyCmd gate (the verifier)
     if gate.pass: return {pass:true, ...}                 # EARLY-STOP on first gate-pass (cost-efficient)
  return {pass:false}                                       # all N failed -> caller HALTs (fail-closed)
```

## Code (to add to `fix_pipeline.mjs`)
Config (near PLAN_CAP, line 28):
```js
const RESAMPLE_N = parseInt(process.env.FIX_RESAMPLE_N || "4", 10);  // #99: best-of-N resample on self-repair stall
```
Stage opt-in (LIVE_STAGES — `write-code` and `design-tests`):
```js
"write-code":  { ..., resampleFallback: true },
"design-tests":{ ..., resampleFallback: true },
```
Refactor (prereq): extract the per-attempt gate evaluation already inline in the goal loop
(oracle-guard → determinism → regression → verifyCmd) into a local `async function evalGate()` returning
`{pass, feedback, sig}`, so BOTH the normal loop and the resample call the identical gate (single source of
truth — no drift between the repair gate and the resample gate).

Hook (inside runLiveStage's goal loop, where it currently calls `haltStage("regression gate unresolved...")`):
```js
if (goalStalled(prevSig, sig)) {
  if (s.resampleFallback && RESAMPLE_N > 1) {
    console.error(`[resample ${stageKey}] self-repair stalled — best-of-${RESAMPLE_N} from ${preStageRef.slice(0,7)} (early-stop on gate-pass)`);
    for (let k = 1; k <= RESAMPLE_N; k++) {
      await _exec("git", ["-C", cwd, "reset", "--hard", preStageRef]);   // fresh slate
      await _exec("git", ["-C", cwd, "clean", "-fd"]);                    // drop churn (keeps gitignored plan/.aiv)
      await _exec("bash", ["-lc", `cd ${cwd} && (echo y | aiv abandon) 2>/dev/null || true`]);
      console.error(`[resample ${stageKey}] attempt ${k}/${RESAMPLE_N} (fresh, vary approach)`);
      await spawnOnce(`FRESH RESAMPLE ${k}/${RESAMPLE_N}: prior approaches stalled at the gate. Implement THE PLAN from a clean slate; take a DIFFERENT approach than a minimal patch. ${feedback}`);
      if ((await commitCount()) === 0) continue;                         // no commits -> next sample
      const g = await evalGate();
      if (g.pass) { console.error(`[resample ${stageKey}] attempt ${k} PASSED gate — selected (recovered a stalled stage)`); return; /* success path: mark + return as the normal green exit does */ }
      console.error(`[resample ${stageKey}] attempt ${k} failed gate (${g.sig})`);
    }
    console.error(`[resample ${stageKey}] all ${RESAMPLE_N} resamples failed the gate`);
  }
  haltStage(`regression gate unresolved (no progress): ...`);   // fail-closed (unchanged)
}
```
`preStageRef`: capture once before the goal loop — `const preStageRef = (await _exec("git",["-C",cwd,"rev-parse","HEAD"])).out.trim();`

## Fail-closed safety analysis (the load-bearing property)
- A resample is **selected ONLY if it passes the SAME deterministic gate** (regression baseline-subtracted +
  verifyCmd). A weak model still **cannot false-pass** — the gate decides, exactly as in the normal loop.
- If all N resamples fail → **HALT** (unchanged fail-closed behavior). The fallback can only turn a HALT into a
  pass, never a HALT into a false-green.
- `git reset --hard preStageRef` is bounded to the worktree and only discards the **stalled** write-code churn
  (the design-tests RED tests at `preStageRef` are preserved; gitignored plan/.aiv survive `clean -fd`).
- `aiv abandon` resets a half-open change context so each fresh attempt's packet is clean (prevents the
  stalled attempt's partial aiv state from contaminating the resample).

## Cost
Early-stop ⇒ expected ≈ `1/passRate` resamples. At EXP-2b's ~60–70% per-sample rate, ≈1.5 extra attempts to
recover a stalled stage. Each attempt runs the gate (full suite) — same cost as one self-repair round. Bounded
by `RESAMPLE_N` (default 4). Only fires AFTER self-repair stalls (rare), so near-zero cost on the common path.

## Selftests to add
- `RESAMPLE_N` parses from env, default 4.
- `write-code`/`design-tests` carry `resampleFallback: true`; gate-only stages (check-drift/or-review/aiv-audit) do NOT.
- (C-guard) the extracted `evalGate` is the SAME predicate used by both the repair loop and the resample (no drift).
- A unit over the loop logic: stalled + resampleFallback + a mocked gate that passes on attempt k ⇒ returns
  success at k; a gate that never passes ⇒ HALT after N.

## Open questions / risks
1. **`aiv abandon` semantics on reset:** confirm abandon + a fresh `aiv begin` works after `reset --hard`
   (the aiv change state may live partly outside the worktree). Validate on the first live use.
2. **design-tests resample:** design-tests' "gate" is packet validity (RED tests), not regression — resample
   there means re-authoring tests; lower value than write-code. Consider enabling write-code first only.
3. **Diversity — ANSWERED by EXP-4 (do NOT raise temperature for laguna):** EXP-4b showed laguna is
   temperature-sensitive — temp-0.7 samples *degraded* (greedy passed, hotter samples failed) — and its
   failures are systematic (all samples fail together), so hotter sampling hurts without recovering. Get
   diversity from the **"vary approach" PROMPT** (different fix strategy), NOT temperature. Best-of-N is a
   **secondary** fallback for the coder; self-repair (1–2 rounds) is the primary recovery. When all resamples
   fail (systematic), HALT is correct.
4. **Interaction with oracle-guard:** a resample re-triggers oracle-guard (good — still protects the oracle).
