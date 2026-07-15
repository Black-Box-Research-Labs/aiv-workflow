#!/usr/bin/env bash
# burn_engine.sh — keep TARGET drives alive as CHILDREN of this process, cycling through all resumable specs.
# Run this via the harness's run_in_background (NOT setsid): a run_in_background task keeps executing across
# turn gaps, so its children (the drives) survive too — unlike setsid-detached supervisors, which the
# environment reaps during idle gaps. Resumes each finding from its state.json cursor; skips terminal + F14/F15.
set -u
export FIX_TRAINDATA_DIR="${FIX_TRAINDATA_DIR:-/home/user/aiv-polymath-traindata}"
cd "$(dirname "$0")"                                  # orchestration/tools
TARGET="${1:-12}"; HOURS="${2:-5}"
DEADLINE=$(( $(date +%s) + HOURS*3600 ))
W="../src/fix/.work"; ELOG="$W/logs/_engine.log"; mkdir -p "$W/logs"
term() { grep -qE "SPINE COMPLETE|DONE — H2 resolved|finding REFUTED \(exit 5\)|fail-closed HALT \(exit 3\)|STOP — FATAL|STOP — deterministic gate|exhausted [0-9]+ attempts" "$1" 2>/dev/null; }
echo "[$(date -u +%H:%M:%S)] ENGINE START target=$TARGET hours=$HOURS pid=$$" >> "$ELOG"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  running=0; tdone=0; total=0
  for sp in "$W"/spec_F*.json; do
    [ -f "$sp" ] || continue
    fid="$(basename "$sp" .json | sed 's/^spec_//')"
    case "$fid" in F14|F15) continue;; esac          # already inflight (PR #27/#28) / done
    total=$((total+1))
    pfx="aiv-$(echo "$fid" | tr 'A-Z' 'a-z')"; lg="$W/logs/$pfx.log"
    if term "$lg"; then tdone=$((tdone+1)); continue; fi
    if pgrep -f "logs/$pfx.log" >/dev/null 2>&1; then running=$((running+1)); continue; fi   # already driving
    if [ "$running" -lt "$TARGET" ]; then
      _DRIVE_DETACHED=1 bash ../src/drive_supervisor.sh "$sp" "$lg" >/dev/null 2>&1 &
      running=$((running+1)); sleep 1
    fi
  done
  echo "[$(date -u +%H:%M:%S)] running=$running terminal=$tdone/$total load=$(cut -d' ' -f1 /proc/loadavg)" >> "$ELOG"
  [ "$tdone" -ge "$total" ] && [ "$total" -gt 0 ] && { echo "[$(date -u +%H:%M:%S)] all terminal — ENGINE EXIT" >> "$ELOG"; break; }
  sleep 90
done
echo "[$(date -u +%H:%M:%S)] ENGINE DONE" >> "$ELOG"
