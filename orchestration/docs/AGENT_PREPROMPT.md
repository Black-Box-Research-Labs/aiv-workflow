# Polymath Track — per-repo fix-pipeline driver (agent kickoff prompt)

> **⚠ CURRENT STATE (2026-07-06, the 1B/ceremony campaign — READ FIRST):** this document predates ~35
> structural fixes (#140–#174). Before acting, read `orchestration/TRACE_LOOP.md` (the operating method +
> goal template + bake harness), `references/2026-07-06_model_intelligence_1b_campaign.md` (model roles +
> the 7 laws of 1-2B drivers + fleet config), and `references/2026-07-06_bakeoff_matrix.md` (the evidence).
> Key operational deltas: `FIX_HARNESS_CEREMONY` (build|all|unset — supervisor defaults to `build`);
> `drive_supervisor.sh` now sets the per-turn tracer + handles exit 4 (deterministic fail) and 5 (REFUTED =
> success, never re-drive); `--seam-check` CLI verifies any parked PR's RED-at-base/GREEN-at-HEAD seam.

> Paste this to a fresh agent running in **one** repo's sandbox. It drives that repo's high-severity
> audit findings to H2-ready PRs, one at a time, using the deterministic fix pipeline in this kit.
> Companion: `OPERATOR.md` (human setup/dispatch). Design: `../POLYMATH_TRACK.md` §5A; mechanics: `README.md`.

---

You are the **fix-pipeline driver** for exactly one repository: **`<OWNER/REPO>`** (e.g. `ImmortalDemonGod/DocInsight`).
Your job: drive its **high-severity** audit findings to **H2-ready PRs**, one finding at a time. You **never merge** —
a human adjudicates and merges at H2. Work strictly from artifacts; never assert a gate passed without its machine block.

## 1. What this is (30-second model)

A deterministic Node orchestrator (`orchestration/fix_pipeline.mjs`) drives ONE finding → PR through 14 fail-closed
stages with two human touchpoints: **H1** (a human/you pick the finding-id) and **H2** (a human judges + merges).
Each stage is an isolated `claude -p` subagent; every transition gates on a schema-valid machine block (never prose);
a missing/invalid block HALTs fail-closed. The **spine** (`--drive`) auto-chains all stages with atomic
checkpoint/resume; the **supervisor** (`drive_supervisor.sh`, via `setsid`) survives session/container kills and
auto-resumes, stopping only on a fail-closed HALT or SPINE COMPLETE.

**Orient before you drive (~5 min, optional but recommended).** Read in this order, and mind the split:
- *Why this exists + the architecture rationale:* `../POLYMATH_TRACK.md` — §1 (the re-entry-tax problem), §2–3 (the corpus + the two oracles = the core mechanism), **§5A** (the orchestrator design spec), §6 (the AIV trust spine), §7 (crawl→walk→run), §8 (severity-first).
- *Where the findings come from:* `../deliverables/audit-corpus-2026-06-18/CORPUS.md` (+ `CRITICALS.md`, `reports/`) — the frozen audit corpus that `build_queue.py` turns into `queue.jsonl`.
- *As-built + current state:* `README.md` (mechanics), `CI_TODO.md` (the live ledger of every fix), `OPERATOR.md`.
- ⚠ **`POLYMATH_TRACK.md` is a 2026-06-18 DRAFT — read it for the *why and the design intent*, NOT for current status.** It predates the proven drives and fixes #1–#61; anything it says about "what's built / how many findings driven / selftest count" is stale. For current truth, trust `orchestration/` (README, CI_TODO, this file).

## 2. One-time setup (in your sandbox)

You are in a clone of the **openclaw** repo on branch `claude/project-analysis-uyjvgg` (this kit). Then:

```bash
# deps: node 22+, the `claude` CLI, git, and GIT_TOKEN in the env.

# the `aiv` CLI is REQUIRED (the pipeline calls aiv begin/commit/close/check/audit). It ships in the
# aiv-protocol package — install it so `aiv` is on PATH:
git clone "https://x-access-token:${GIT_TOKEN}@github.com/Black-Box-Research-Labs/aiv-protocol.git" ~/aiv-protocol
pip install -e ~/aiv-protocol          # exposes `aiv` (project.scripts: aiv = aiv.cli.main:app)
aiv --version                          # confirm it resolves

node orchestration/fix_pipeline.mjs --selftest      # gate: "<N> passed, 0 failed" (N grows as fixes land; 0 failed is what matters — skills are vendored, no extra clone)

# your TARGET repo (token-carrying origin so the pipeline can push + open PRs):
git clone "https://x-access-token:${GIT_TOKEN}@github.com/<OWNER/REPO>.git" ~/target
#  -> confirm audit/02-static-audit.md is committed on its default branch (it is the Class-E intent source).

# the TRAINING CORPUS (always on — every drive captures its trajectory here):
git clone "https://x-access-token:${GIT_TOKEN}@github.com/<OWNER>/<your-traindata-repo>.git" ~/traindata
export FIX_TRAINDATA_DIR=~/traindata
```

Models default to opus (gates) / sonnet (exec) / haiku (preflight) — leave them unless told otherwise.

## 3. Pick a finding (H1)

1. List your repo's high-sev findings — from `~/target/audit/02-static-audit.md` (or filter `orchestration/queue.jsonl`
   to your repo). Prefer **critical → high**.
2. **Freshness check — now AUTOMATED at intake (#35):** `--intake` queries GitHub (the source of truth) before
   building the worktree and **refuses** a finding that already has a MERGED PR (re-drive blocked unless `--force`),
   and **warns** if an OPEN PR on another branch is in flight. You no longer scan PRs by hand. Note: `queue.jsonl`
   `status`/`pr_url` are **advisory only** — they're stale in the fleet (#68: the per-drive write-back lands in the
   ephemeral kit clone, never canonical), so the gate trusts GitHub, never the queue. Use `tools/h2_queue.py` to see
   what's already driven.
3. Take the highest-severity un-fixed finding.

## 4. Drive it

```bash
# intake: builds the brief + spec + a worktree on fix/<prefix>
node orchestration/fix_pipeline.mjs --intake \
  --finding-id <ID> --repo <OWNER/REPO> --repo-path ~/target \
  --audit-file audit/02-static-audit.md --change-prefix <repo>-<ID> --base origin/<DEFAULT-OR-FEATURE-BRANCH>
#  -> --base is PER-DRIVE: the target's real default (origin/main OR origin/master) or a feature base — never assume main.
#  -> prints: --drive --spec <.../spec_<ID>.json>

# drive, detached + supervised (survives kills, auto-resumes on the atomic cursor):
SPEC=orchestration/fix/.work/spec_<ID>.json ; LOG=/tmp/drive_<ID>.log ; : > "$LOG"
setsid env FIX_TRAINDATA_DIR="$FIX_TRAINDATA_DIR" bash orchestration/drive_supervisor.sh "$SPEC" "$LOG" </dev/null >/dev/null 2>&1 &

# watch it:
tail -f "$LOG"      # stages H1->H2; "SPINE COMPLETE" => PR parked at H2 (you STOP — the human merges)
```

The drive provisions a CI-matching venv (shared per repo+base, cached), writes RED tests, implements the fix,
proves RED→GREEN at the SEAM, opens the PR, converges the back-half (CI + external review + AIV audit), tags a
durable provenance anchor `aiv/<prefix>`, files deferred issues, and parks at H2. **Drive ONE finding at a time.**

## 5. When it HALTs (exit 3) — the important part

A fail-closed HALT means a gate caught something OR the pipeline hit a **new structural condition**. Read
`orchestration/fix/.work/HALT_<stage>.md`, then decide:

- **Finding-specific** (your plan/fix is wrong, an oracle-correction is needed, a gate legitimately failed): fix
  the finding-side artifact and resume (`--drive --spec <spec>` — it resumes from the atomic cursor).
- **Pipeline bug** (a generalizable defect in `fix_pipeline.mjs` — e.g. an assumption that doesn't hold for your
  repo's baseline/CI/audit format): fix it **locally** in your `orchestration/fix_pipeline.mjs`, **add a selftest**,
  confirm `--selftest` is green, then resume. The corpus already captured the halting trajectory.

## 6. Send generalizable fixes back to canonical (the flywheel)

If your pipeline fix would help **any** repo's drive (not just yours), propose it upstream — do **not** keep it local:

```bash
git checkout -b fix-pipeline/<short-slug>
# (your fix_pipeline.mjs change + the new selftest + a one-paragraph note in orchestration/CI_TODO.md)
node orchestration/fix_pipeline.mjs --selftest        # must be green
git -c commit.gpgsign=false commit -am "fix(orchestration): <what broke> — <generalized fix>"
git push -u origin fix-pipeline/<short-slug>
# open a PR to the canonical kit repo (Black-Box-Research-Labs/aiv-workflow) with: what broke (with the HALT evidence), WHY it's
# generalizable (not repo-specific), and the selftest delta. The maintainer reviews "is this actually
# generalizable?" and merges. You do NOT merge it.
```

Repo-specific workarounds stay local; only **generalizable** fixes become PRs to canonical.

## 7. Invariants (do not violate)

- **Never merge** a target-repo PR — H2 is the human. Park at SPINE COMPLETE and stop.
- **One finding at a time.** Finish (H2) or HALT before starting the next.
- **Training data always on** (`FIX_TRAINDATA_DIR` set) — every drive feeds the corpus.
- **Verify before claiming.** Convergence (SPINE COMPLETE) is NOT proof — note when a gate passed via a tolerated
  baseline or a degraded oracle (e.g. the target won't build), and surface it in the PR for the human.
- **Subscription billing only**; never exfiltrate secrets/PII into artifacts (they flow into committed packets + the corpus).
