#!/bin/bash
# usage: bakeoff.sh <stage> <model-cascade> <label> <worktree> [text_tools]
STAGE="$1"; MODEL="$2"; LABEL="$3"; WT="$4"; TT="${5:-0}"
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
cd "$(dirname "$0")/.."   # orchestration/ root (script lives in orchestration/bake/)
export PATH="$PWD/drivers/openrouter/bin:$PATH"; unset OPENROUTER_API_KEY
set -a; source ../.env; set +a
export FIX_WORK=$SC/bake_work_${LABEL}_${STAGE}
export FIX_TRAINDATA_DIR=$HOME/traindata   # a clone of YOUR own training-data repo
export FIX_MODEL_CASCADE="$MODEL"
[ "$TT" = "1" ] && export FIX_TEXT_TOOLS=1
export FIX_SHIM_TRACE=$SC/trace_bake_${LABEL}_${STAGE}.jsonl
[ "$KEEP_WORK" != "1" ] && rm -rf $FIX_WORK 2>/dev/null; mkdir -p $FIX_WORK
timeout 2000 node fix_pipeline.mjs --run-stage $STAGE --spec $SC/bake_specs/spec_${LABEL}.json --cwd "$WT" > $SC/bake_${LABEL}_${STAGE}.log 2>&1
RC=$?
echo "EXIT=$RC [$LABEL/$STAGE]"
exit $RC
