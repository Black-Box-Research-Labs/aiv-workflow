#!/usr/bin/env bash
# saturate.sh — keep the drive fleet at TARGET active drives until the queue drains or the deadline passes.
# Every cycle: reap terminal drives, then refill to TARGET (sequential intake + detached supervisors).
# Detached burn-loop for a fixed usage window; all output → _saturator.log.  Usage: saturate.sh [TARGET] [HOURS]
set -u
export FIX_TRAINDATA_DIR="${FIX_TRAINDATA_DIR:-/home/user/aiv-polymath-traindata}"
cd "$(dirname "$0")"
TARGET="${1:-26}"; HOURS="${2:-5}"
DEADLINE=$(( $(date +%s) + HOURS*3600 ))
LOG="../src/fix/.work/logs/_saturator.log"; mkdir -p "$(dirname "$LOG")"
echo "[$(date -u +%H:%M:%S)] saturator START target=$TARGET hours=$HOURS deadline=$(date -u -d @$DEADLINE +%H:%M 2>/dev/null || echo $DEADLINE)" >> "$LOG"
dry=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  node drive_fleet.mjs --reap >> "$LOG" 2>&1
  out="$(node drive_fleet.mjs --refill "$TARGET" 2>&1)"; echo "$out" >> "$LOG"
  launched="$(printf '%s' "$out" | grep -oE 'launched [0-9]+ new' | grep -oE '[0-9]+' | head -1)"
  cand="$(printf '%s' "$out" | grep -oE 'of [0-9]+ candidate' | grep -oE '[0-9]+' | head -1)"
  st="$(node drive_fleet.mjs --status 2>/dev/null | grep -oE 'running=[0-9]+ done=[0-9]+ refuted=[0-9]+ halted=[0-9]+')"
  echo "[$(date -u +%H:%M:%S)] $st | +${launched:-0} launched | ${cand:-0} candidates left | load $(cut -d' ' -f1 /proc/loadavg)" >> "$LOG"
  if [ "${cand:-0}" = "0" ] && [ "${launched:-0}" = "0" ]; then dry=$((dry+1)); else dry=0; fi
  [ "$dry" -ge 3 ] && { echo "[$(date -u +%H:%M:%S)] queue drained (3 dry cycles) — exiting" >> "$LOG"; break; }
  sleep 720
done
echo "[$(date -u +%H:%M:%S)] saturator DONE" >> "$LOG"
