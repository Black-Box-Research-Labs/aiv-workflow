#!/bin/bash
# NOTE: reference bench script — assumes your local env (Ollama path, pre-created wc-green tag,
# local model names). Adapt to your setup before running.
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
export FIX_HARNESS_CEREMONY=1
L="$1"; MODEL="$2"; TT="$3"; WT=$SC/bakeWT_qcoder
git -C $WT reset --hard wc-green -q; git -C $WT clean -fdx -e .venv 2>/dev/null
mkdir -p $WT/.aiv/plans $WT/.aiv/launch-briefs/primordial-f017-walk
cp $SC/canon/primordial-f017-walk-plan.md $WT/.aiv/plans/
cp $SC/canon/pr-primordial-f017-walk*.md $WT/.aiv/launch-briefs/primordial-f017-walk/
echo "PRECHECK: fix-present=$(grep -c '86400/1.496e8' $WT/src/parameter_sampler.py) test-green=$(cd $WT && .venv/bin/python -m pytest tests/test_primordial_f017_walk.py -q 2>&1 | grep -c '1 passed')"
echo "=== $L | $MODEL tt=$TT | prove-it (wc-green precondition) ==="
timeout 2000 bash $SC/bakeoff.sh prove-it "$MODEL" "$L" "$WT" "$TT"
echo "  evidence files: $(ls $WT/.github/aiv-packets/evidence/primordial-f017-walk/ 2>/dev/null | tr '\n' ' ')"
/Applications/Ollama.app/Contents/Resources/ollama stop ${MODEL#local:} 2>/dev/null
echo "PI-DONE"
