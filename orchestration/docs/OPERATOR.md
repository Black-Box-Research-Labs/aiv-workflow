# Polymath Track — operator manual (dispatching the fleet)

> **⚠ CURRENT STATE (2026-07-06, the 1B/ceremony campaign — READ FIRST):** this document predates ~35
> structural fixes (#140–#174). Before acting, read `orchestration/TRACE_LOOP.md` (the operating method +
> goal template + bake harness), `references/2026-07-06_model_intelligence_1b_campaign.md` (model roles +
> the 7 laws of 1-2B drivers + fleet config), and `references/2026-07-06_bakeoff_matrix.md` (the evidence).
> Key operational deltas: `FIX_HARNESS_CEREMONY` (build|all|unset — supervisor defaults to `build`);
> `drive_supervisor.sh` now sets the per-turn tracer + handles exit 4 (deterministic fail) and 5 (REFUTED =
> success, never re-drive); `--seam-check` CLI verifies any parked PR's RED-at-base/GREEN-at-HEAD seam.

> How you (the human) stand up per-repo fix-pipeline agents from this one kit, and what lands on your desk.
> The agent-facing instructions are `AGENT_PREPROMPT.md`. Mechanics: `README.md`. Ledger: `CI_TODO.md`.
> **Before picking a finding + authoring a prompt, run the pre-flight in `DISPATCH_PLAYBOOK.md`** — especially the
> oracle-strength triage (don't dispatch a weak self-authored `goal_condition` when an external oracle exists) —
> then fill `DISPATCH_TEMPLATE.md` (the canonical dispatch header; don't hand-roll prompts).

## The model (one link, N isolated agents)

The kit is the **openclaw branch `claude/project-analysis-uyjvgg`** (this folder). Each repo's agent runs in its
**own isolated sandbox** (own disk/CPU — no shared resources, no cross-talk except via PRs). You point each agent
at the **one PR/branch link**; it clones the branch, follows `AGENT_PREPROMPT.md`, drives **its** repo's findings,
and proposes any generalizable pipeline fixes back as **PRs to openclaw** that you review. One human-gated writer
(you, on canonical), N proposers.

```
        openclaw branch (this kit, canonical)  ──clone──►  agent@DocInsight ─┐
                          ▲                     ──clone──►  agent@mastery   ─┼─► drive findings → PRs at H2 (you merge)
        PR to openclaw ◄──┘ (generalizable      ──clone──►  agent@pytest-fixer┘
        (you review)        pipeline fixes)               each pushes trajectories → your traindata repo
```

## Per-agent prerequisites (the agent's sandbox needs)

- `node` 22+, the `claude` CLI, `git`, and **`GIT_TOKEN`** with push on the target repo.
- the **`aiv` CLI** (required — the pipeline calls `aiv begin/commit/close/check/audit`): `pip install -e` the
  `Black-Box-Research-Labs/aiv-protocol` package, which exposes the `aiv` command on PATH.
- The target repo must have **`audit/02-static-audit.md` committed** on its default branch (the Class-E intent source).
- Skills are the aiv-workflow repo's own `skills/` at the root (the driver reads `../skills` from `orchestration/`); no separate clone or vendored copy — one source of truth. Override with `AIV_WORKFLOW_SKILLS` to point at a different skills dir.
- A clone of **your own training-data repo** with `FIX_TRAINDATA_DIR` pointed at it (training capture always on).

## Dispatch (per repo)

Give the agent: the kit link + the `AGENT_PREPROMPT.md` with `<OWNER/REPO>` filled in. The pilot set:

| Repo | Drive these first (high-sev, audit-committed) |
|---|---|
| `ImmortalDemonGod/DocInsight` | **F11** (`eval()` RCE, critical) → then F30 |
| `ImmortalDemonGod/mastery-engine` | the cosine-validator-wrong-file finding → other highs |
| `ImmortalDemonGod/Pytest-Error-Fixing-Framework` | **F15** (`success_count` never increments) → other highs |

The agent freshness-checks each finding against merged/open PRs before driving (#35), drives one at a time, and
parks at H2.

## What lands on your desk (review bandwidth is the real ceiling)

**See the live H2 queue any time:** `python3 orchestration/tools/h2_queue.py` — sweeps every target repo's drive
PRs (incl. out-of-MCP-scope ones via `GIT_TOKEN`) and prints `repo · PR · finding · KIND · severity · state · CI`.
State + CI are **live from GitHub** (CI via check-runs, which — unlike the combined-status API — sees GitHub
Actions jobs, so it catches per-platform failures); finding/KIND/severity join from the audit corpus. A committed
point-in-time snapshot is `orchestration/H2_QUEUE.md` (regenerate with `--md`; it's stale the moment CI moves).
**Caveats:** `CI=none` = no CI workflows in that repo (e.g. PrimordialEncounters); `CI=RED` may be *pre-existing*
red tolerated by the drive's baseline-subtraction (#26) — confirm the failing checks are novel before discounting
the PR; the finding/KIND join is best-effort (a `?` means a non-drive or oddly-branched PR).

1. **Target-repo PRs at H2** — one per converged finding. Adjudicate + merge. **Before merging, decide the merge
   method:** the packet pins SHAs and the repos merge via rebase, which rewrites them — the pipeline mitigates this
   by tagging the pre-merge head `aiv/<prefix>` (#36), so the pins resolve via `git fetch origin 'refs/tags/aiv/*'`
   even after rebase. (Verify the tag exists before merging.)
   **Finding the driven PRs (#43):** every completed drive records its PR link in two places — the queue row
   (`orchestration/queue.jsonl` → `status:"pr_open"`, `pr_url`, `branch`) and, durably across sandboxes, the
   training corpus (`<your-traindata-repo>/drives/<id>/manifest.json` → `repo` + `pull` + `pr_url`). The corpus
   manifests are the authoritative cross-fleet index (committed+pushed); the queue write-back lands in whatever
   clone drove it (push it to canonical as a deliberate data-PR if you want the canonical queue current). A human
   verdict on a queue row (`judged_merged`/`judged_rejected`/`exhausted`) is never downgraded by a re-drive.
2. **Pipeline-improvement PRs to openclaw** — when an agent hits a generalizable break. Review for "is this actually
   generalizable vs. a repo-specific workaround?", that it carries a **selftest**, and that `--selftest` is green.
   This is the flywheel: N agents surface generalization gaps far faster than serial single-drives.

## Reviewing an H2 PR — the proof-strength triage

SPINE COMPLETE means the pipeline *converged*, not that the proof is strong. Check the PR body's evidence for:
- **Strong**: behavioral RED→GREEN actually executed (real test run), CI genuinely green.
- **Degraded (scrutinize)**: proof leaned on static/dry-run evidence because the target wouldn't build, or CI
  passed via baseline-subtraction of pre-existing red (#25/#26). These are *honest and surfaced*, but they mean the
  fix is verified more weakly — judge accordingly. (A buildable target is a precondition for a strong execution oracle.)

## Status of this kit (as of 2026-06-21)

`--selftest` **206/206** (run for the current count — it grows as fixes land; **0 failed** is the gate). Proven on
**Seven converged drives** — across logic / CLI / **workflow** / scientific finding KINDs — have reached the H2
boundary (one merged by the operator). With `FIX_TRAINDATA_DIR` set, the pipeline captures every drive's full
trajectory into a training-data repo you control, for distilling cheaper drivers later (see
`DESIGN_TRAINDATA_CORPUS.md`).

## Orienting a newcomer (the why-vs-as-built split)

If someone unfamiliar needs to understand this PR: read `../POLYMATH_TRACK.md` for the **why + design intent**
(§1 the problem, §2–3 corpus + the two oracles, §5A the orchestrator spec, §6 AIV spine, §7 cadence, §8 priority),
and `../deliverables/audit-corpus-2026-06-18/CORPUS.md` for where the findings come from. **But treat
`POLYMATH_TRACK.md` as a 2026-06-18 draft — design intent, not current status** (it predates the drives + fixes
#1–#52). For as-built/current truth, use `orchestration/` (`README.md`, `CI_TODO.md`, `AGENT_PREPROMPT.md`). The
agent-facing reading order + this caveat are baked into `AGENT_PREPROMPT.md` §1.
