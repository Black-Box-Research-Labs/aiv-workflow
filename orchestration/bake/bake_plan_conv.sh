#!/bin/bash
# NOTE: reference bench script — hardcodes specific model IDs (nemotron cascade + a local Ollama
# model) and an Ollama path. Adapt the CAS/model names and env to your setup before running.
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
export FIX_HARNESS_CEREMONY=1 KEEP_WORK=1
WT=$SC/bakeWT_lfm
CAS="nim:nvidia/nemotron-3-ultra-550b-a55b,nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free"
git -C $WT reset --hard origin/master -q; git -C $WT clean -fdx -e .venv 2>/dev/null
mkdir -p $WT/.aiv/launch-briefs/primordial-f017-walk
cp $SC/canon/pr-primordial-f017-walk*.md $WT/.aiv/launch-briefs/primordial-f017-walk/
rm -rf $SC/bake_work_planlfm_plan $SC/bake_work_planlfm_check-drift
for IT in 1 2 3; do
  echo "=== CONV ITER $IT: plan(lfm, scaffolded) ==="
  timeout 2000 bash $SC/bakeoff.sh plan local:lfm-fixpipe planlfm $WT 1
  echo "PLAN-EXIT-ABOVE iter$IT"
  /Applications/Ollama.app/Contents/Resources/ollama stop lfm-fixpipe 2>/dev/null
  P=$WT/.aiv/plans/primordial-f017-walk-plan.md
  [ -f "$P" ] && echo "CONV-PLAN iter$IT: $(wc -c <$P|tr -d ' ') chars, $(grep -cE '^#{1,4}.*§' $P) headings, $(grep -c 'FILL' $P) unfilled markers"
  echo "=== CONV ITER $IT: check-drift(nemotron) ==="
  timeout 1500 bash $SC/bakeoff.sh check-drift "$CAS" planlfm $WT 0
  rc=$?
  echo "CONV-GATE-RC iter$IT $rc"
  [ $rc -eq 0 ] && echo "CONV-CONVERGED iter$IT" && break
  # carry the verdict to the next plan iteration
  mkdir -p $SC/bake_work_planlfm_plan/verdicts/primordial-f017-walk
  cp $SC/bake_work_planlfm_check-drift/verdicts/primordial-f017-walk/check-drift.md $SC/bake_work_planlfm_plan/verdicts/primordial-f017-walk/ 2>/dev/null
done
echo "CONV-DONE"
