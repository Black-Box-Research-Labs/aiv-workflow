#!/bin/bash
SC="${BAKE_ROOT:?export BAKE_ROOT=<work dir for bake logs/specs/worktrees>}"
export FIX_HARNESS_CEREMONY=1
NEWOL=/Applications/Ollama.app/Contents/Resources/ollama
L="$1"; MODEL="$2"; TT="$3"; WT=$SC/bakeWT_$L
git -C $WT reset --hard origin/master -q; git -C $WT clean -fdx -e .venv 2>/dev/null; git -C $WT rm -q -f --ignore-unmatch ".github/aiv-packets/PACKET_primordial_f017*" 2>/dev/null; git -C $WT checkout -q origin/master -- . 2>/dev/null
mkdir -p $WT/.aiv/plans $WT/.aiv/launch-briefs/primordial-f017-walk
cp $SC/canon/primordial-f017-walk-plan.md $WT/.aiv/plans/
cp $SC/canon/pr-primordial-f017-walk*.md $WT/.aiv/launch-briefs/primordial-f017-walk/
echo "=== $L | model=$MODEL tt=$TT | design-tests ACCEPTANCE (#143+#144) ==="
timeout 2100 bash $SC/bakeoff.sh design-tests "$MODEL" "$L" "$WT" "$TT"
echo "  commits: $(git -C $WT log --oneline 85099f7..HEAD 2>/dev/null | wc -l|tr -d ' ')"
echo "  packet: $(ls $WT/.github/aiv-packets/PACKET_primordial* 2>/dev/null | xargs -n1 basename 2>/dev/null)"
OLLAMA_HOST=127.0.0.1:11434 "$NEWOL" stop ${MODEL#local:} 2>/dev/null
echo "ONE-DONE"
