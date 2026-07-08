#!/bin/bash
# END-TO-END 1B MINI-WALK: vf -> design-tests -> test-quality -> write-code -> prove-it, chained state, no resets between.
# NOTE: reference bench script — assumes your local env (Ollama path, local model names like qcoder-fixpipe/
# lfm-fixpipe). Adapt to your setup before running.
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
OL=/Applications/Ollama.app/Contents/Resources/ollama
export FIX_HARNESS_CEREMONY=1
WT=$SC/bakeWT_qcoder
# clean-state at TRUE base, canon producers injected once
git -C $WT reset --hard origin/master -q; git -C $WT clean -fdx -e .venv 2>/dev/null
mkdir -p $WT/.aiv/plans $WT/.aiv/launch-briefs/primordial-f017-walk
cp $SC/canon/primordial-f017-walk-plan.md $WT/.aiv/plans/
cp $SC/canon/pr-primordial-f017-walk*.md $WT/.aiv/launch-briefs/primordial-f017-walk/
echo "E2E-PRECHECK bug=$(grep -c '1.731e6' $WT/src/parameter_sampler.py) commits=$(git -C $WT log --oneline origin/master..HEAD|wc -l|tr -d ' ')"
run() { # stage model label tt
  echo "=== E2E STAGE: $1 ($2) ==="
  timeout 2000 bash $SC/bakeoff.sh "$1" "$2" "$3" "$WT" "$4"
  local rc=$?
  echo "E2E-STAGE-RC $1 $rc"
  if [ "$rc" -ne 0 ]; then
    echo "E2E-HALTED-AT $1"
    "$OL" stop qcoder-fixpipe lfm-fixpipe 2>/dev/null
    exit "$rc"
  fi
}
run verify-finding local:qcoder-fixpipe e2e 1
run design-tests   local:qcoder-fixpipe e2e 1
"$OL" stop qcoder-fixpipe 2>/dev/null
run test-quality   local:lfm-fixpipe    e2e 1
"$OL" stop lfm-fixpipe 2>/dev/null
run write-code     local:qcoder-fixpipe e2e 1
run prove-it       local:qcoder-fixpipe e2e 1
"$OL" stop qcoder-fixpipe 2>/dev/null
echo "=== E2E FINAL AUDIT ==="
echo "constant: $(grep 'KM_S_TO_AU_DAY =' $WT/src/parameter_sampler.py | head -1)"
(cd $WT && .venv/bin/python -m pytest -q 2>&1 | tail -1)
ls $WT/.github/aiv-packets/PACKET_primordial_f017* 2>/dev/null | xargs -n1 basename
ls $WT/.github/aiv-packets/evidence/primordial-f017-walk/ 2>/dev/null | tr '\n' ' '
echo ""
echo "E2E-DONE"
