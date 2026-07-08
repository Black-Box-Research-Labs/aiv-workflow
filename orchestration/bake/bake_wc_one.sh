#!/bin/bash
# usage: bake_wc_one.sh <label> <model> <tt>
# NOTE: reference bench script — assumes your local env (Ollama path, pre-created stage tags
# dt-green/wc-green, local model names). Adapt to your setup before running.
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
export FIX_HARNESS_CEREMONY=1
L="$1"; MODEL="$2"; TT="$3"; WT=$SC/bakeWT_qcoder   # write-code always runs on the dt-green worktree
# precondition: the GREEN design-tests state + canon plan/brief (untracked, re-copy)
git -C $WT reset --hard dt-green -q; git -C $WT clean -fdx -e .venv 2>/dev/null
mkdir -p $WT/.aiv/plans $WT/.aiv/launch-briefs/primordial-f017-walk
cp $SC/canon/primordial-f017-walk-plan.md $WT/.aiv/plans/
cp $SC/canon/pr-primordial-f017-walk*.md $WT/.aiv/launch-briefs/primordial-f017-walk/
# representative-state check: RED test present+red, bug present, impl packet absent
echo "PRECHECK: red-test=$(cd $WT && .venv/bin/python -m pytest tests/test_primordial_f017_walk.py -q 2>&1 | grep -c '1 failed') bug=$(grep -c '1.731e6' $WT/src/parameter_sampler.py) impl-packet=$(ls $WT/.github/aiv-packets/*impl* 2>/dev/null | wc -l | tr -d ' ')"
echo "=== $L | model=$MODEL tt=$TT | write-code (dt-green precondition) ==="
timeout 2000 bash $SC/bakeoff.sh write-code "$MODEL" "$L" "$WT" "$TT"
echo "  commits past dt-green: $(git -C $WT log --oneline dt-green..HEAD 2>/dev/null | wc -l|tr -d ' ')"
echo "  constant now: $(grep 'KM_S_TO_AU_DAY =' $WT/src/parameter_sampler.py | head -1)"
/Applications/Ollama.app/Contents/Resources/ollama stop ${MODEL#local:} 2>/dev/null
echo "WC-DONE"
