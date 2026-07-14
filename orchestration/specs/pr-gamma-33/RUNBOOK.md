# PR-γ.33 drive — launch runbook

The fix pipeline drives **PR-γ.33** (Tracker UI prod-functional closure, §1.1 drive-side) on black-box,
end-to-end H1→H2, capturing the full trajectory to `aiv-polymath-traindata`. Operator decisions locked
2026-07-14: **Path B** (re-target preflight to forensic-node capability), **build the Node lane** (done),
**operator launches + babysits to H2**.

## What's wired

| Piece | Value |
|---|---|
| Spec | `orchestration/specs/pr-gamma-33/spec_pr_gamma_33.json` |
| Finding (H1) | `orchestration/specs/pr-gamma-33/finding_pr_gamma_33.md` (approach-agnostic oracle; Path B recommended) |
| Class-E anchor | black-box `audit/pr-gamma-33-finding.md` (intentSource, on-disk in cwd) |
| Target config | black-box `.aiv-workflow.yml` (npm ci / vitest / §15.3 / 6h CR window) |
| cwd | `/home/user/black-box` (already on the mandated branch `claude/pr-gamma-33-tracker-ui-f87229` == origin/main) |
| Traindata sink | `/home/user/aiv-polymath-traindata` (drive dir: `drives/pr-gamma-33-tracker-prod/`) |
| Node lane | `provisionEnv`/`ciTestCmd`/`autoFormatChanged` now package.json-aware (selftest 421/0) |

## Pre-flight (validated)

- `node src/fix_pipeline.mjs --selftest` → **421 passed, 0 failed**
- `node src/fix_pipeline.mjs --dry-run` → reaches `pr_open`, negative SEAM-HALT OK
- `node src/fix_pipeline.mjs --preflight` → live `claude -p` spawn works
- `node src/fix_pipeline.mjs --drive --plan --spec …` → spec parses, resume cursor fresh
- GitHub API reachable via **default** node fetch (PR-open/CI-poll work) — do **NOT** set `NODE_USE_ENV_PROXY`
- git push works via the local proxy; `aiv` on PATH; traindata sink guard passes (writable git clone)

## Launch (detached, auto-resuming supervisor)

```bash
cd /home/user/aiv-workflow/orchestration
export FIX_TRAINDATA_DIR=/home/user/aiv-polymath-traindata   # MANDATORY — a real --drive fails closed without it
export FIX_HARNESS_CEREMONY=off                              # full-agentic (capable model) — novel Node R2 target
# GIT_TOKEN is already in the env (PR-open/CI-poll + push). Do NOT export NODE_USE_ENV_PROXY (breaks api.github.com).
bash src/drive_supervisor.sh specs/pr-gamma-33/spec_pr_gamma_33.json /home/user/black-box/../drive-gamma-33.log
```

The supervisor self-detaches (survives session events) and auto-resumes on the atomic `state.json` cursor.
It STOPS only on: fail-closed HALT (exit 3), FATAL (exit 2), or SPINE COMPLETE (parks at H2).

## Babysit (via `/loop`)

Poll the drive + PR on an interval and carry signals back until H2:

```
/loop 10m  check the γ.33 drive: tail the drive log, read orchestration WORK/state.json cursor,
           and the PR's CI/review; act on any HALT (diagnose + resume) or CI-red; stop when the
           spine parks at H2 (awaiting-H2) or on an unrecoverable HALT.
```

## H2 (operator — irreducible, NOT automated)

When the drive parks at H2 it has: the Path-B code fix + false-green-quota fix + extended specs +
AIV packets + an open PR with the canonical packet body + green local oracle. The operator then does the
**§1.1 production bar** (VERIFY [6]/[7]/[10]):

1. On prod `www.blackboxresearchlabs.com/tracker`: target-select → **LAUNCH enables** → dispatch →
   chain-progress lights per gate → SSE live-feed streams **≥5 events over ~10 min** (no "Reconnecting
   attempt N") → findings render.
2. Post **≥3 screenshots** (preflight-all-green, LAUNCH-dispatched, live-feed-streaming) + explicit
   **VISUAL SIGN-OFF** comment.
3. `Closes #295` + the preflight-blocker issue; 6h CR-quiet-window; `gh pr merge --rebase --delete-branch`.

## Known Node-drive risks to babysit

- Stage prompts (design-tests/write-code/prove-it) carry Python-flavored hints (`.venv`/pytest). The
  finding's "Toolchain" header + a capable model override this, but watch the first design-tests/prove-it
  passes for pytest/venv confusion.
- Husky 1+1 on black-box commits — the `aiv` ceremony emits 1 functional + 1 packet per commit (compliant),
  but watch for hook rejections. Never `--no-verify`/`--amend` (contract VERIFY [14]).
- black-box CI includes a self-hosted Mac-mini runner (playwright-prod) that can time out — poll-ci is
  bounded; a runner stall surfaces as a HALT to diagnose, not an auto-retry-into-the-ground.
