#!/bin/bash
# bake_stage.sh — per-stage bake runner (consolidates bake_dt_one/wc_one/pi_one/plan_conv/e2e).
# Reset a worktree to the stage's precondition, inject the canon plan/brief, then run one pipeline
# stage (or the plan<->check-drift convergence loop / the 5-stage e2e chain) via bakeoff.sh.
#
# NOTE: reference bench script — assumes your local env (Ollama path, pre-created stage tags
# dt-green/wc-green, local model names). Adapt to your setup before running.
#
# usage:
#   bake_stage.sh dt   <label> <model> <tt>   # design-tests acceptance (resets to origin/master)
#   bake_stage.sh wc   <label> <model> <tt>   # write-code (resets to the dt-green tag)
#   bake_stage.sh pi   <label> <model> <tt>   # prove-it (resets to the wc-green tag)
#   bake_stage.sh plan-conv                   # plan <-> check-drift convergence loop
#   bake_stage.sh e2e                         # 5-stage chained mini-walk
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
OL=/Applications/Ollama.app/Contents/Resources/ollama
MODE="$1"

inject_plan_brief() {   # $1 = worktree
  mkdir -p "$1/.aiv/plans" "$1/.aiv/launch-briefs/primordial-f017-walk"
  cp "$SC/canon/primordial-f017-walk-plan.md" "$1/.aiv/plans/"
  cp "$SC"/canon/pr-primordial-f017-walk*.md "$1/.aiv/launch-briefs/primordial-f017-walk/"
}

case "$MODE" in
  dt)
    export FIX_HARNESS_CEREMONY=1; L="$2"; MODEL="$3"; TT="$4"; WT="$SC/bakeWT_$L"
    git -C "$WT" reset --hard origin/master -q; git -C "$WT" clean -fdx -e .venv 2>/dev/null
    git -C "$WT" rm -q -f --ignore-unmatch ".github/aiv-packets/PACKET_primordial_f017*" 2>/dev/null
    git -C "$WT" checkout -q origin/master -- . 2>/dev/null
    inject_plan_brief "$WT"
    echo "=== $L | model=$MODEL tt=$TT | design-tests ACCEPTANCE (#143+#144) ==="
    timeout 2100 bash "$SC/bakeoff.sh" design-tests "$MODEL" "$L" "$WT" "$TT"
    echo "  commits: $(git -C "$WT" log --oneline 85099f7..HEAD 2>/dev/null | wc -l | tr -d ' ')"
    echo "  packet: $(ls "$WT"/.github/aiv-packets/PACKET_primordial* 2>/dev/null | xargs -n1 basename 2>/dev/null)"
    "$OL" stop "${MODEL#local:}" 2>/dev/null; echo "ONE-DONE" ;;

  wc)
    export FIX_HARNESS_CEREMONY=1; L="$2"; MODEL="$3"; TT="$4"; WT="$SC/bakeWT_qcoder"
    git -C "$WT" reset --hard dt-green -q; git -C "$WT" clean -fdx -e .venv 2>/dev/null
    inject_plan_brief "$WT"
    echo "PRECHECK: red-test=$(cd "$WT" && .venv/bin/python -m pytest tests/test_primordial_f017_walk.py -q 2>&1 | grep -c '1 failed') bug=$(grep -c '1.731e6' "$WT/src/parameter_sampler.py") impl-packet=$(ls "$WT"/.github/aiv-packets/*impl* 2>/dev/null | wc -l | tr -d ' ')"
    echo "=== $L | model=$MODEL tt=$TT | write-code (dt-green precondition) ==="
    timeout 2000 bash "$SC/bakeoff.sh" write-code "$MODEL" "$L" "$WT" "$TT"
    echo "  commits past dt-green: $(git -C "$WT" log --oneline dt-green..HEAD 2>/dev/null | wc -l | tr -d ' ')"
    echo "  constant now: $(grep 'KM_S_TO_AU_DAY =' "$WT/src/parameter_sampler.py" | head -1)"
    "$OL" stop "${MODEL#local:}" 2>/dev/null; echo "WC-DONE" ;;

  pi)
    export FIX_HARNESS_CEREMONY=1; L="$2"; MODEL="$3"; TT="$4"; WT="$SC/bakeWT_qcoder"
    git -C "$WT" reset --hard wc-green -q; git -C "$WT" clean -fdx -e .venv 2>/dev/null
    inject_plan_brief "$WT"
    echo "PRECHECK: fix-present=$(grep -c '1\.496e8' "$WT/src/parameter_sampler.py") test-green=$(cd "$WT" && .venv/bin/python -m pytest tests/test_primordial_f017_walk.py -q 2>&1 | grep -c '1 passed')"
    echo "=== $L | $MODEL tt=$TT | prove-it (wc-green precondition) ==="
    timeout 2000 bash "$SC/bakeoff.sh" prove-it "$MODEL" "$L" "$WT" "$TT"
    echo "  evidence files: $(ls "$WT"/.github/aiv-packets/evidence/primordial-f017-walk/ 2>/dev/null | tr '\n' ' ')"
    "$OL" stop "${MODEL#local:}" 2>/dev/null; echo "PI-DONE" ;;

  plan-conv)
    export FIX_HARNESS_CEREMONY=1 KEEP_WORK=1; WT="$SC/bakeWT_lfm"
    CAS="nim:nvidia/nemotron-3-ultra-550b-a55b,nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free"
    git -C "$WT" reset --hard origin/master -q; git -C "$WT" clean -fdx -e .venv 2>/dev/null
    mkdir -p "$WT/.aiv/launch-briefs/primordial-f017-walk"
    cp "$SC"/canon/pr-primordial-f017-walk*.md "$WT/.aiv/launch-briefs/primordial-f017-walk/"
    rm -rf "$SC/bake_work_planlfm_plan" "$SC/bake_work_planlfm_check-drift"
    for IT in 1 2 3; do
      echo "=== CONV ITER $IT: plan(lfm, scaffolded) ==="
      timeout 2000 bash "$SC/bakeoff.sh" plan local:lfm-fixpipe planlfm "$WT" 1
      echo "PLAN-EXIT-ABOVE iter$IT"
      "$OL" stop lfm-fixpipe 2>/dev/null
      P="$WT/.aiv/plans/primordial-f017-walk-plan.md"
      [ -f "$P" ] && echo "CONV-PLAN iter$IT: $(wc -c <"$P" | tr -d ' ') chars, $(grep -cE '^#{1,4}.*§' "$P") headings, $(grep -c 'FILL' "$P") unfilled markers"
      echo "=== CONV ITER $IT: check-drift(nemotron) ==="
      timeout 1500 bash "$SC/bakeoff.sh" check-drift "$CAS" planlfm "$WT" 0
      rc=$?
      echo "CONV-GATE-RC iter$IT $rc"
      [ "$rc" -eq 0 ] && echo "CONV-CONVERGED iter$IT" && break
      # carry the verdict to the next plan iteration
      mkdir -p "$SC/bake_work_planlfm_plan/verdicts/primordial-f017-walk"
      cp "$SC/bake_work_planlfm_check-drift/verdicts/primordial-f017-walk/check-drift.md" "$SC/bake_work_planlfm_plan/verdicts/primordial-f017-walk/" 2>/dev/null
    done
    echo "CONV-DONE" ;;

  e2e)
    export FIX_HARNESS_CEREMONY=1; WT="$SC/bakeWT_qcoder"
    # clean-state at TRUE base, canon producers injected once
    git -C "$WT" reset --hard origin/master -q; git -C "$WT" clean -fdx -e .venv 2>/dev/null
    inject_plan_brief "$WT"
    echo "E2E-PRECHECK bug=$(grep -c '1.731e6' "$WT/src/parameter_sampler.py") commits=$(git -C "$WT" log --oneline origin/master..HEAD | wc -l | tr -d ' ')"
    run() {   # stage model label tt
      echo "=== E2E STAGE: $1 ($2) ==="
      timeout 2000 bash "$SC/bakeoff.sh" "$1" "$2" "$3" "$WT" "$4"
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
    echo "constant: $(grep 'KM_S_TO_AU_DAY =' "$WT/src/parameter_sampler.py" | head -1)"
    (cd "$WT" && .venv/bin/python -m pytest -q 2>&1 | tail -1)
    ls "$WT"/.github/aiv-packets/PACKET_primordial_f017* 2>/dev/null | xargs -n1 basename
    ls "$WT"/.github/aiv-packets/evidence/primordial-f017-walk/ 2>/dev/null | tr '\n' ' '
    echo ""; echo "E2E-DONE" ;;

  *)
    echo "usage: bake_stage.sh dt|wc|pi <label> <model> <tt>  |  plan-conv  |  e2e" >&2; exit 2 ;;
esac
