# Driving an audit corpus through the fix pipeline

Two small tools that turn a forensic **audit corpus** into a ratified worklist the fix pipeline can
drive one finding at a time — with a `/loop`-friendly driver that checks *before* driving so nothing
already fixed (or already in-flight as an open PR) gets re-driven.

```
05-plan.md + 02-static-audit.md   ──gen_queue.mjs──▶   ../src/queue.jsonl   ──drive_next.mjs──▶   fix_pipeline.mjs --drive
     (the audit corpus)                                 (ratified worklist)        (/loop body)         (one drive → PR @ H2)
```

See the companion analysis [`docs/DRIVING-THE-AUDIT-CORPUS.md`](../../docs/DRIVING-THE-AUDIT-CORPUS.md)
for the full architecture. This README is the operational quickstart.

---

## 1. `gen_queue.mjs` — build the worklist

Emits `../src/queue.jsonl` (where `fix_pipeline.mjs`'s `queueRow()` reads it) from the corpus's
**deduplicated, dependency-ordered 79-item plan** — *not* the 251 raw findings (which over-count ~10:1).

```bash
node gen_queue.mjs           # defaults to the aiv-protocol 2026-06-18 forensic corpus
node gen_queue.mjs --audit-dir <dir> --repo <owner/name> --repo-path <clone> --stdout
```

Per plan item it: picks a **representative `F##`** (the first `links_to` id that exists as a row in
`02-static-audit.md`, so `auditTableRow` can resolve its Class-E intent); seeds `goal_condition` from the
plan's **`Verification`** field (the oracle seed); namespaces the drive id (`change_prefix = aiv-f##`) so
the training corpus never collides with another repo's `F##`; and pre-marks status from the target repo's
git log + `FINDINGS.md` (see §3).

## 2. `drive_next.mjs` — advance the queue by one drive (the `/loop` body)

Each invocation: (1) reconciles any in-flight drive from its supervisor log + traindata manifest;
(2) reconciles against **GitHub PRs** (merged → `fixed`, open → `inflight`); (3) picks the next
`pending`, dependency-unblocked finding by rank; (4) preflights it (pure `--drive --plan`); and, only
with `--go` and when prerequisites are met, (5) runs `--intake` and launches `drive_supervisor.sh`
**detached**. One drive at a time; safe to call repeatedly.

```bash
node drive_next.mjs                 # DRY: reconcile + show the next finding + the exact launch cmds
node drive_next.mjs --go            # LAUNCH the next drive in the background (prereqs permitting)
node drive_next.mjs --status        # just print the queue rollup + any in-flight drive
node drive_next.mjs --go --plan P5  # drive a SPECIFIC item instead of rank order (e.g. skip a heavy P1)
```

### Driving with `/loop`

```
/loop 30m node /home/user/aiv-workflow/orchestration/tools/drive_next.mjs --go
```

Every 30 min: reconcile finished drives, and if none is in flight, launch the next pending finding.
A drive is 30–90 min, so most ticks just report the in-flight one; when it parks at H2 (or is refuted),
the next tick advances. Stop the loop when `drive_next` reports **`queue drained`**.

### Prerequisites for `--go`

| Need | Why |
|---|---|
| `FIX_TRAINDATA_DIR` = a **writable git clone** | trajectory capture is fail-closed — no sink, no drive (exit 3) |
| `claude` on `PATH` | the per-stage subagent driver |
| `GIT_TOKEN` | freshness gate + PR reconcile + opening the PR (stage 8) |
| **`aiv` on `PATH`** (`pip install -e <target-repo>`) | the harness's mechanical `aiv commit` in `design-tests` calls **bare `aiv`** — a venv-only `.venv/bin/aiv` is NOT enough; without a global `aiv` the drive HALTs fail-closed at `design-tests` (`exit 127`) |

`drive_next --go` checks these and **refuses to launch** (rather than HALT mid-drive) if any is missing.

```bash
export FIX_TRAINDATA_DIR=/home/user/aiv-polymath-traindata   # the training-corpus clone
export GIT_TOKEN=…                                           # GitHub token
```

## 3. Check-before-driving — four independent guards

Nothing already handled gets re-driven, at four layers (defence in depth):

1. **Static triage (`gen_queue.mjs`)** — marks `status: fixed` for findings named in the target repo's
   `fix`/`remediat` git-log commits **and** in `FINDINGS.md`'s remediated `### C*` sections. *(Current
   corpus: P3/F96, P16/F43, P17/F113.)*
2. **PR reconciliation (`drive_next.mjs`, every tick)** — GitHub is the source of truth: a **merged** PR
   for a finding → `fixed`; an **open** PR → `inflight` (driven, awaiting human merge — not re-driven).
   *(This is what caught F14/P4 → PR #27; the static triage alone missed it because the PR isn't merged.)*
3. **Freshness gate (pipeline, at intake)** — refuses a finding with a merged PR (exit 2 unless `--force`).
4. **Finding-falsification (pipeline, `verify-finding`)** — if the defect isn't present in the code, the
   stage emits `verdict: refuted` and terminates successfully (exit 5) **without driving a fix**.

## 4. Queue schema (`../src/queue.jsonl`, one JSON row per plan item)

| Field | Consumed by | Meaning |
|---|---|---|
| `finding_id` | pipeline (`queueRow`/`auditTableRow`) | representative `F##` — resolves the Class-E intent row |
| `repo` | pipeline (`queueRow` match) | short repo name (`aiv-protocol`) |
| `location`, `goal_condition` | pipeline (spec fallback + oracle) | bug-site + the plan's Verification (oracle seed) |
| `repo_full`, `change_prefix` | `drive_next` (intake args) | `owner/name` + namespaced drive id |
| `plan_id`, `rank`, `depends_on` | `drive_next` (ordering + gating) | plan item id, security-first rank, `P##` deps |
| `status`, `triage`, `pr` | `drive_next` (state machine) | `pending`/`fixed`/`inflight`/`driving`/`done`/`refuted`/`halted`/`needs-human` |

**Statuses:** `pending` → (`done` = PR@H2 / `refuted` = defect absent / `halted` = needs attention).
`fixed` = merged already. `inflight` = open PR already. `needs-human` = plan item didn't converge (P77,
P79) — a human decision, never auto-driven. The transient **`driving`** state and its absolute log/spec
paths are **not** written to the tracked queue — they live in a gitignored sidecar
(`src/fix/.work/drive-runtime.json`), so a live drive never churns machine-specific paths into git.

## 5. Current snapshot (regenerate to refresh)

`aiv-protocol` 2026-06-18 forensic corpus — **79 plan items**: **3 fixed** (P3/F96·C2, P16/F43·C1,
P17/F113·H12), **2 inflight** (P4/F14·H1 traversal → PR #27; **P5/F15·H2 SSRF → PR #28**, the first
harness-driven drive), **2 needs-human** (P77, P79), **72 pending**. First pending by rank: **P1/F23**
(tier-map unification). P5/F15 was the proof drive — it reproduced the SSRF, added a scheme+IP allowlist in
`_is_url_allowed`, proved RED→GREEN, and opened PR #28 with the full trajectory captured to the training repo.
