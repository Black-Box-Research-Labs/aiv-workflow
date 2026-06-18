---
name: poll-ci
description: Poll a PR's CI checks until terminal (all pass / any fail), then read the code-review bot's review body and report status. NEVER auto-merge. Use when the user says "poll and get the ci green", "poll ci", "is ci green", "make sure you are polling properly", "wait for ci", "check ci", or any variant asking to watch CI to completion.
---

# Poll CI - watch checks until terminal, then report

You are watching a PR's CI checks until they finish, then reading the code-review bot's review body. Do NOT merge. Do NOT auto-fix failures. Wait for the operator.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). Keys used: `ci.local_replica_cmd` (the pre-push replica command),
> `merge.strategy` (default `rebase`), `merge.delete_branch` (default `true`), `merge.autonomous`
> (MUST be `false`). If the file is absent, use these defaults and say so.

## 1. Identify the PR

In order of preference:

1. **User named a PR number** ("poll ci on #168") -> use that number directly
2. **User said "this PR" / "the PR" / no number** -> resolve from current branch:
   ```bash
   gh pr view --json number,title,headRefName 2>/dev/null
   ```
   If no PR is open for the current branch, ask the user which PR or whether they want one opened first.
3. **Multiple worktrees** -> run the resolution from the worktree's path (`cd` first); don't assume the primary repo.

State the resolved PR + title in one line before polling so the operator can correct if wrong.

## 2. Poll with the native primitive

Use `gh`'s built-in watch - don't reimplement a polling loop:

```bash
gh pr checks <N> --watch --interval 30 --fail-fast
```

- `--watch` blocks until checks are terminal (all SUCCESS / any FAILURE / required-only logic)
- `--interval 30` refreshes every 30 seconds (default is 10s which is wasteful)
- `--fail-fast` exits the watch on first failure so you can report immediately

**Foreground vs background:**
- For CI expected under 5 minutes (the common case): run foreground; the Bash tool's 10-min default timeout covers it.
- For CI expected over 5 minutes (large refactors, full-monorepo runs): use `run_in_background: true`. You'll be notified on completion.
- Do not use a scheduled-wakeup mechanism for CI polling. CI is typically faster than the cache TTL, so a wakeup that straddles it is pure overhead; `--watch` + act-on-return is the correct pattern.

**Mechanism truth - what a backgrounded watch actually notifies (read this; it is the most-repeated mistake):**
- A `gh pr checks --watch` run via `run_in_background: true` notifies you **exactly once - on exit**. It emits **no per-check signal mid-run**. So **never tell the operator "it will alert me when something fails"** - a backgrounded Bash cannot do that. Any interim `echo` inside a hand-rolled loop just buffers to the output file silently; you only see it when the whole thing exits.
- `--fail-fast` **is** the early-failure mechanism: it makes the watch **exit on the first failure**, and that exit IS your notification. Use it whenever you want to act the instant something goes red.
- The only tool that streams per-event alerts is `Monitor` (one notification per stdout line) - but for CI you do **not** want it; `--fail-fast` + act-on-return is the correct native pattern. Reaching for `Monitor` to "watch CI" is the reimplemented-loop anti-pattern wearing a different hat.

**Act-on-return - the instant the watch exits, DIAGNOSE; never re-arm a passive wait:**
- When the watch returns (a `--fail-fast` early exit OR an all-terminal exit), your **immediate next action is to act on what it returned**: for a red, fetch the failed job log (`gh run view <run-id> --log-failed`, or `gh api repos/<o>/<r>/actions/jobs/<job-id>/logs` when the parent run is still in progress), classify it (real-and-mine / flake / pre-existing-on-main / infra), then report or decide.
- **Do NOT launch a second `--watch` to "wait for the remaining checks" once a failure is already surfaced.** The failure is already actionable. If you genuinely need a still-pending check's result before deciding, take a single `gh pr checks <N>` snapshot - do not re-block on another passive watch. Re-arming a watch on an already-known-red state is passive-waiting; it is exactly the behavior an operator will keep flagging ("why are you waiting to deal with the failure?").
- **Pre-existing-on-main test:** to prove a red is not yours, fetch the SAME job's failing spec list on `main` HEAD (the commit you rebased onto) and diff it against your PR's failing list. Identical set on a surface disjoint from your diff = pre-existing/isolated, not yours. Cite both run IDs when you report.

**A `--watch` can hang forever - bound the wait; never let a backgrounded watch be your only signal:**
- `--watch` returns only when checks reach a **terminal** state. A check stuck `pending` - queued behind a saturated runner pool, or a **wedged** self-hosted runner (`busy=true` with `0 in_progress` per `gh api repos/<o>/<r>/actions/runners`) - **never goes terminal**, so a backgrounded watch (especially **without `--fail-fast`**, which waits for *all* checks) can block **indefinitely** while the jobs you care about already failed or passed. This can burn hours: the watch sits on a `pending` aggregate check while the real test jobs long ago finished red.
- **Bound it.** If a backgrounded watch has not notified within roughly the expected job wall-clock, **stop waiting and take a direct snapshot** - `gh pr checks <N>` for the rollup, and `gh api repos/<o>/<r>/actions/jobs/<job-id>` for step-level state even while the parent run is still in progress. On self-hosted runners individual jobs finish while a sibling/aggregate check stays `pending`, so "all-terminal" may never arrive.
- **Default to `--fail-fast`** for backgrounded watches so the first red is the notification. Reserve no-fail-fast full-completion watches for when you have already confirmed the runners are healthy and draining - otherwise you are betting on an exit that may not come.
- **Check the runner fleet when checks sit at `pending 0s`.** `gh api repos/<o>/<r>/actions/runners` (online/busy) + `gh run list --status in_progress|queued`. Both runners `busy=true` with `0 in_progress` = a hung/orphaned job is wedging the slots; `ps -Ao pid,etime,command | grep _work` on the self-hosted box shows whether a `Runner.Worker` is genuinely running vs stuck. Surface this - it is infra, not the PR - and don't keep re-watching a wedged pool.

## 3. On terminal - branch by outcome

### 3a. ALL GREEN

```bash
gh pr view <N> --json reviews,reviewDecision,mergeable,mergeStateStatus
```

Read the JSON and report:

- All N checks: SUCCESS (list them)
- Review decision: `APPROVED` / `COMMENTED` / `CHANGES_REQUESTED` / null
- **The review body.** A green "SUCCESS" status from a code-review bot DOES NOT mean no findings - a bot can report SUCCESS while its review body holds actionable comments. Always read the most recent review body and surface any actionable items. Don't paste the whole body; summarize: N nitpicks, M actionable, K duplicates-still-applicable.
- Mergeable state: `MERGEABLE` / `CONFLICTING` / `UNKNOWN`

Then: **WAIT for the operator decision**. Do NOT merge.

The human is the merge gate - `merge.autonomous` is `false` and must stay false. The 4-step gate sequence:
1. CI green ✓
2. Review body read ✓
3. Operator asked via AskUserQuestion: "All green. Review findings: [summary]. Merge now?"
4. Operator confirms -> only then run the configured merge. With `merge.strategy: rebase` and
   `merge.delete_branch: true` (the defaults) that is:
   ```bash
   gh pr merge <N> --rebase --delete-branch
   ```
   The strategy flag comes from `merge.strategy` (squash is forbidden - atomic commits must land on
   main as-is); add `--delete-branch` only when `merge.delete_branch` is `true`.

### 3b. ANY RED

Surface immediately:
- Failing check name(s) with their URLs
- For each failure, fetch the failed run's log tail:
  ```bash
  gh run view <run-id> --log-failed | tail -100
  ```
- Identify which job + step failed
- Report the failure mode (test failure / lint / build / timeout / etc.)
- **DO NOT auto-fix.** Surface the failure, recommend a path forward, wait for operator instruction.

When a test fails, ask which side is wrong before editing either. Never reflexively edit a test to make it pass - that masks the real defect instead of fixing it.

### 3c. PARTIAL - required green, optional red

This is usually fine to merge but worth confirming. Report:
- Required checks: all SUCCESS
- Optional checks failing: [list]
- Whether any failing optional is the code-review bot (treat as required for review purposes)
- Ask the operator: "Required green; optional failures are [list]. Merge anyway, or wait?"

## 4. Hard rules

- **NEVER auto-merge.** Even when explicitly told "wait for ci then merge" - that's a sequence, not autonomous-merge authorization. The human is the merge gate (`merge.autonomous: false`); the 4-step gate must complete with explicit operator confirmation at step 3.
- **NEVER trigger a code-review bot's full re-review manually.** A bot's auto-skip on push IS the convergence signal; manual re-triggers create review treadmills.
- **NEVER fix tests reflexively** to make CI green. Diagnose the root cause first; ask which side is wrong before editing either.
- **If CI is failing on something the local replica would have caught** - acknowledge the local-CI-first discipline and propose running the configured replica (`ci.local_replica_cmd`) before re-pushing. Never push knowing CI will fail: a full matrix reruns on every push, turning CI budget into "see what happens" binary search. Enumerate every known failure and fix or pin them all locally first.

## 5. Anti-patterns

- **Reimplementing a polling loop with `sleep` + `gh pr checks`.** Use `--watch` - it does this natively.
- **Using a scheduled-wakeup mechanism for CI polling.** CI is faster than the cache TTL; the straddle is pure overhead.
- **Asking "should I continue waiting?" during the poll.** During execution the answer is always continue. Don't ask.
- **Reporting "CI is green" without reading the review body.** A green status with unread actionable findings burns a follow-up cycle.
- **Auto-merging on green.** Never. AskUserQuestion first; the human is the merge gate.
- **Treating "wait for ci then merge" as autonomous-merge permission.** It's a sequence directive; the 4-step gate still applies.
- **Claiming a backgrounded watch "will alert me when something fails."** It won't - a bg Bash notifies once, on exit. Only `--fail-fast` (exit-on-red) or `Monitor` (per-line) alert early. Say what the mechanism actually does, not what you wish it did.
- **Re-arming a second `--watch` after a failure is already known.** That is passive-waiting on an actionable red. Diagnose the red now; snapshot any still-pending check with a single `gh pr checks`, don't re-block.
- **Answering a "why" question by silently doing a fix instead of stating the answer.** When the operator asks "why does X / is that what the skill says / why are you waiting," first *answer the literal question in words*, then act. Doing-without-answering reads as dodging, and the root never gets fixed.
