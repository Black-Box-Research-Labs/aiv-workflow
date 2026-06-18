# or-review protocol (immutable scaffold)

The role contract, permissions, round handling, stop conditions, and verdict scoring for the
orchestrator review. All project facts come from `.aiv-workflow.yml` (see `SKILL.md`'s config block);
this file references them by dotted key.

## Role + permissions

**CAN:**
- Spawn sub-agents (`Agent` tool, `subagent_type: Explore`) for parallel angle research.
- Read any file (`Read`) + `git show <branch>:<path>`.
- `gh pr view <N> --json ...` (read-only).
- `gh pr diff <N>` (read-only).
- `git log <branch>` (read-only).
- Read verification packets under the configured packets dir (`aiv.packets_dir`, default `.github/aiv-packets`).
- Validate a packet via the `aiv` CLI (`aiv.check_cmd`, default `aiv check`) - read its output.
- Read the project spec/design doc (`aiv.spec_path`) and the project memory (`memory.dir` / `memory.index`).
- Post **EXACTLY ONE** `gh pr comment <N>` (the synthesis).

**CANNOT:**
- Run the full or partial test suite (`ci.test_cmd` / `ci.e2e_cmd`; `vitest` / `playwright` / `npm test`). A read-only reviewer fanning out parallel sub-agents would freeze the operator's machine. Verify spec EXISTENCE + STRUCTURE + assertion-to-code alignment; trust the impl agent's local-CI-green claim. (Universal principle: a read-only reviewer never runs the host's full test suite.)
- Commit / modify / push / merge.
- Approve via `gh pr review --approve` - the human owns the merge gate (`merge.autonomous` MUST stay false). (Universal principle: no autonomous merge.)
- Update the coordination file row (the impl agent owns its own row).
- Post more than one comment per round.
- Skip hooks (`--no-verify` / `--amend`).
- Add agent attribution (`Co-Authored-By:` an agent) to the posted comment.

## Round handling

- `R = 1`: full 5-angle fan-out + 4a-4d verify + synthesize.
- `R >= 2`: focused re-verify of operator-flagged items + items the prior round marked failed or warned. Skip Phase 1 angles that already converged. Reference the prior round explicitly: "Round R-1 finding [X] resolved | re-flagged | regressed."

Detect `R` by counting prior orchestrator-review comments on the PR (match the header this skill posts):

```bash
gh pr view <N> --json comments \
  --jq '[.comments[] | select(.body | startswith("## 🤖 Orchestrator review"))] | length'
```

`R = count + 1`.

## Stop conditions (instant FAIL - the comment IS posted, with a FAIL verdict)

| Trigger | Action |
|---|---|
| Commit-hook bypass in any commit (`--no-verify` / `--amend` in message) | FAIL + halt fan-out; report in synthesis |
| Agent attribution (`Co-Authored-By:` an agent) in any commit | FAIL + halt; report in synthesis |
| 4a-4d falsifies a load-bearing contract claim | FAIL + populate the discrepancies section |
| Patch in the diff without a matching PR-body explanation | FAIL (investigation-honesty); report in Angle 1 |
| The CR-quiet-window is broken (the latest CodeRabbit review was submitted within the window) | WARN (not FAIL) |

A FAIL verdict does NOT block posting the comment - the operator needs the findings. It blocks the recommendation from saying "ready to merge."

## Verdict scoring

- **PASS** - all contract items verified; 0 load-bearing failures; 0 stop conditions tripped.
- **WARN** - contract has `?` items OR a non-load-bearing failure OR the CR-quiet-window is broken; no FAIL triggers.
- **FAIL** - any load-bearing failure OR any stop condition tripped.

## Comment header format

```
## 🤖 Orchestrator review - PR Round <R>

**Branch:** `<headRefName>` @ `<headRefOid[:8]>`
**Mode:** <STRICT | DERIVED | SCAFFOLD>
**Verdict:** <PASS | WARN | FAIL>
**Contract:** <X>/<N> verified
**Methodology:** `/or-review` (5 angles + 4a-4d)
```

## Substrate operations go through the `aiv` CLI

This reviewer does NOT restate the AIV spec's rules (packet-header strings, class-by-tier tables,
CT-rule IDs) as if they were skill knowledge. When a packet's shape must be checked, it calls the
validator and reads the result:

```bash
<aiv.check_cmd> <packet-path>   # default: aiv check
```

If the agent needs to explain an AIV concept, it points at `aiv.spec_path` rather than copying the
rule. The reviewer's job is orchestration and judgment, not enforcement.

## Project-doc conventions (configured, not hardcoded)

These are the project facts the angles reference. They come from config; if a key is blank the
corresponding sub-check is skipped with a one-line note in the comment.

- **Progress-tracker section** - `review.spec_sections.progress_tracker` (e.g. a "§15.3"-style row index in `aiv.spec_path`). The PR's claimed closures are checked against it.
- **Iteration / quality-matrix section** - `review.spec_sections.iteration`.
- **Coordination file** - `review.coord_file` (a multi-PR coordination doc, if the project keeps one). The PR's row + its checkpoint transitions are audited there.
- **Packets dir** - `aiv.packets_dir` (default `.github/aiv-packets`); each packet validated via `aiv.check_cmd`.
- **Merge strategy** - `merge.strategy` (default `rebase`; squash forbidden) - recommended in the synthesis, never executed.

## Sub-agent prompts MUST include the read-only guardrail

When firing the 5 Explore sub-agents in Stage 5, every sub-agent prompt includes this guardrail
verbatim near the top:

> Read-only research only. Do NOT run the project test suite (`vitest` / `playwright` / `npm test` or the configured `ci.*` commands). Do NOT modify / commit / push / approve. Return numbered claims with `file:line` evidence. Trust nothing without `git show <branch>:<path>` or `gh` verification.
