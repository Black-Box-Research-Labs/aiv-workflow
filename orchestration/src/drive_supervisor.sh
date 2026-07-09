#!/usr/bin/env bash
# Detached, auto-resuming supervisor for a `fix_pipeline.mjs --drive` run.
#
# WHY: the drive is long (30-90 min) and the session/exec environment kills background tasks on session
# events (model switch, compaction, container refresh). A bare background drive dies silently mid-run. So this
# supervisor SELF-DETACHES into a new session (see the detach block below) so a session-scoped kill can't
# reach it, and it RESUMES the drive on an unexpected signal-kill — which is safe because the drive
# checkpoints to an ATOMICALLY-written state.json (a kill can't corrupt the cursor). It STOPS, without
# retrying, on a fail-closed HALT (exit 3) / FATAL (exit 2) / SPINE COMPLETE — so genuine issues surface
# for human attention rather than being auto-retried into the ground.
#
# Usage:  bash drive_supervisor.sh <spec.json> <logfile>
#   (self-detaches — no `setsid`/`nohup`/`&` needed. The FIRST call re-execs itself into a new session and
#    returns immediately; export any FIX_*/API-key env before calling and it propagates to the detached child.)
#
# #172 — FIX_HARNESS_CEREMONY (measured 2026-07-06, see fix_pipeline.mjs header): production drives DEFAULT to
# "build" (harness owns mechanics on design-tests/write-code/prove-it — nemotron all-first-pass, prove-it 87x,
# quality preserved; plan + test-quality stay wide). Override by exporting FIX_HARNESS_CEREMONY before launch:
# "all" = 1B local fleet, any other value (e.g. "off") = full agentic tasks (corpus-generation walks).
set -u
SPEC="${1:?spec.json required}"; LOG="${2:-/tmp/drive.log}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# SELF-DETACH into a new session (portable). The prior contract was "launch me with `setsid ... &`", but
# `setsid` is util-linux — it exists in the container yet is ABSENT on macOS, so the documented invocation
# died on the spot there (the drive never started, log held only the caller's line). Detaching HERE removes
# that platform trap: the caller just runs `bash drive_supervisor.sh spec log`. Mechanism, in order of
# preference: real setsid (Linux) -> perl POSIX::setsid (macOS ships perl, gives a true new session leader)
# -> nohup (last resort: survives SIGHUP but not a full process-group kill). The _DRIVE_DETACHED guard makes
# the re-exec idempotent (the child skips this block and runs the real body). Env is inherited across the
# re-exec, so exported FIX_*/PATH/API keys reach the child unchanged.
if [ -z "${_DRIVE_DETACHED:-}" ]; then
  export _DRIVE_DETACHED=1
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid bash "$0" "$@" </dev/null >>"$LOG" 2>&1 &
  elif command -v perl >/dev/null 2>&1; then
    perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- bash "$0" "$@" </dev/null >>"$LOG" 2>&1 &
  else
    nohup bash "$0" "$@" </dev/null >>"$LOG" 2>&1 &
  fi
  echo "[supervisor] detached into new session: pid=$! log=$LOG"
  exit 0
fi

MAX="${DRIVE_MAX_ATTEMPTS:-40}"
export FIX_HARNESS_CEREMONY="${FIX_HARNESS_CEREMONY:-build}"   # #172: measured production default
# #173: full per-turn observability BY DEFAULT — the shim tracer (FIX_SHIM_TRACE) records every turn's prompt
# size, reasoning, tool calls, latency and usage; the entire 1B/nemotron hardening campaign ran on reading these
# traces, and a production drive without them is un-diagnosable after the fact. Derived from the logfile path so
# each drive gets its own trace next to its log (override or set empty to disable).
export FIX_SHIM_TRACE="${FIX_SHIM_TRACE:-${LOG%.log}_trace.jsonl}"
echo "[supervisor] trace=$FIX_SHIM_TRACE" >> "$LOG"
echo "[supervisor $(date -u +%H:%M:%S)] START detached pid=$$ spec=$SPEC max=$MAX ceremony=$FIX_HARNESS_CEREMONY" >> "$LOG"

# #82: after SPINE COMPLETE, WATCH for a post-H2 human review and re-open the back-half to address it, until the
# operator APPROVES (or the watch window elapses). A review that lands after the PR parks is the normal case;
# re-opening runs reconcile (#80) + cr-review justify-or-change (#81) on the new input — review is "constantly
# looked for", not one-shot. Returns 2 = re-run the drive (new review), 0 = done (approved / window elapsed / no gh).
review_watch() {
  command -v gh >/dev/null 2>&1 || { echo "[watch] no gh — cannot watch reviews; parked at H2" >> "$LOG"; return 0; }
  local repo head pr base0 idle=0 WMAX="${REVIEW_WATCH_POLLS:-48}" WSLEEP="${REVIEW_WATCH_SLEEP:-300}"
  repo="$(sed -n 's/.*"repo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SPEC" | head -1)"
  head="$(sed -n 's/.*"headBranch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SPEC" | head -1)"
  [ -z "$repo" ] && { echo "[watch] no repo in spec; parked" >> "$LOG"; return 0; }
  pr="$(gh pr list --repo "$repo" ${head:+--head "$head"} --json number --jq '.[0].number' 2>/dev/null)"
  [ -z "$pr" ] && { echo "[watch] no open PR for $repo${head:+ ($head)}; parked" >> "$LOG"; return 0; }
  base0="$(gh api "repos/$repo/pulls/$pr/reviews" --jq '[.[]|select(.user.type!="Bot")]|length' 2>/dev/null || echo 0)"
  local iss0; iss0="$(gh api "repos/$repo/issues?state=open&per_page=100" --jq "[.[]|select(.pull_request==null)|select((.body//\"\")|test(\"#$pr([^0-9]|\$)\"))|.comments]|add // 0" 2>/dev/null || echo 0)"
  echo "[watch] watching $repo#$pr for post-H2 review (baseline reviews=$base0, referencing-issue comments=$iss0) ..." >> "$LOG"
  while [ "$idle" -lt "$WMAX" ]; do
    sleep "$WSLEEP"
    local approved now
    approved="$(gh api "repos/$repo/pulls/$pr/reviews" --jq '[.[]|select(.user.type!="Bot" and .state=="APPROVED")]|length' 2>/dev/null || echo 0)"
    [ "${approved:-0}" -gt 0 ] && { echo "[watch] operator APPROVED $repo#$pr — done (agents never merge)." >> "$LOG"; return 0; }
    now="$(gh api "repos/$repo/pulls/$pr/reviews" --jq '[.[]|select(.user.type!="Bot")]|length' 2>/dev/null || echo "$base0")"
    if [ "${now:-0}" -gt "${base0:-0}" ]; then
      echo "[watch] NEW human review on $repo#$pr (was $base0, now $now) — re-opening back-half" >> "$LOG"
      node "$HERE/fix_pipeline.mjs" --reopen-backhalf --spec "$SPEC" >> "$LOG" 2>&1
      return 2
    fi
    local issn; issn="$(gh api "repos/$repo/issues?state=open&per_page=100" --jq "[.[]|select(.pull_request==null)|select((.body//\"\")|test(\"#$pr([^0-9]|\$)\"))|.comments]|add // 0" 2>/dev/null || echo "$iss0")"
    if [ "${issn:-0}" -gt "${iss0:-0}" ]; then
      echo "[watch] NEW issue-channel reply on $repo#$pr (referencing-issue comments $iss0 -> $issn) — re-opening back-half" >> "$LOG"
      node "$HERE/fix_pipeline.mjs" --reopen-backhalf --spec "$SPEC" >> "$LOG" 2>&1
      return 2
    fi
    idle=$((idle+1))
  done
  echo "[watch] no new human review within window ($WMAX polls) — parked at H2." >> "$LOG"; return 0
}

for i in $(seq 1 "$MAX"); do
  # #89: re-resolve the LIVE agent-proxy port before each attempt. This supervisor is detached and
  # long-lived; a worker/session restart ROTATES the proxy port (e.g. 36099 -> 45311), so the
  # HTTPS_PROXY baked at launch goes stale and the drive's git/fetch all fail ("fetch failed", no
  # progress). /root/.ccr/README.md is regenerated each restart with the current port — read it.
  if [ -f /root/.ccr/README.md ]; then
    P="$(grep -oE '127\.0\.0\.1:[0-9]+' /root/.ccr/README.md | head -1 | cut -d: -f2)"
    [ -n "$P" ] && export HTTPS_PROXY="http://127.0.0.1:$P" && export https_proxy="$HTTPS_PROXY"
  fi
  echo "[supervisor $(date -u +%H:%M:%S)] drive attempt $i/$MAX (proxy ${HTTPS_PROXY:-none})" >> "$LOG"
  before=$(wc -l < "$LOG")                          # #46: scope the success grep to THIS attempt's output only —
  node "$HERE/fix_pipeline.mjs" --drive --spec "$SPEC" >> "$LOG" 2>&1   # a stale "SPINE COMPLETE" from a reused
  code=$?                                           # logfile (or a prior attempt) must NOT mark a fresh run done.
  echo "[supervisor $(date -u +%H:%M:%S)] drive exited code=$code" >> "$LOG"
  if tail -n +$((before + 1)) "$LOG" | grep -q "SPINE COMPLETE"; then
    echo "[supervisor] SPINE COMPLETE (PR at H2) — entering review-watch (#82)" >> "$LOG"
    review_watch; rw=$?
    if [ "$rw" = "2" ]; then continue; fi          # a NEW human review arrived → re-run the drive to address it
    echo "[supervisor] DONE — H2 resolved (operator approved or watch window elapsed)" >> "$LOG"; exit 0
  fi
  case "$code" in
    3) echo "[supervisor] STOP — fail-closed HALT (exit 3): needs attention, NOT auto-resuming" >> "$LOG"; exit 3;;
    2) echo "[supervisor] STOP — FATAL (exit 2): needs attention" >> "$LOG"; exit 2;;
    4) echo "[supervisor] STOP — deterministic gate/artifact FAIL (exit 4, e.g. #166 missing graded artifact): a resume re-fails identically; needs attention" >> "$LOG"; exit 4;;   # #172
    5) echo "[supervisor] DONE — finding REFUTED (exit 5): a SUCCESSFUL terminal — the falsification gate did its job; the AUDIT gets the bug report, never re-drive" >> "$LOG"; exit 0;;   # #172
    0) echo "[supervisor] STOP — clean exit 0 but no SPINE COMPLETE (unexpected)" >> "$LOG"; exit 0;;
    *) echo "[supervisor] killed (code=$code, likely env/session event) — RESUMING in 8s" >> "$LOG"; sleep 8;;
  esac
done
echo "[supervisor] STOP — exhausted $MAX attempts" >> "$LOG"; exit 4
