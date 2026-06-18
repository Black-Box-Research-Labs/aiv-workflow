---
name: launch-brief
description: Compose a paired launch brief + completion contract for a new PR. Produces a briefing document for the implementing agent and a binary green/red completion contract that proves the work is done. Classifies the PR up-front by change shape (migration / ui-render / dispatcher / refactor / schema-additive / infrastructure / test-debt / observability / docs, extensible per project) and binds class-specific verification slots beyond the hygiene floor. Lints the output for investigation-slot consistency, class-to-required-slot coverage, brief-gate-to-contract-verify parity, and pre-merge gate-graph completeness. Use when the user says "launch brief", "new PR brief", "completion contract", "draft brief for PR-X", or "spin up brief for issue #N". Does NOT start the PR or open it; the output is documents the operator dispatches.
---

# Launch brief - paired brief + completion contract

You produce **two files per invocation**:

1. **Launch brief** - instructions to the implementing agent: what to do, what to decide, what facts to verify.
2. **Completion contract** - the binary green/red merge gate: an executable checklist that proves the work is done.

Both are derived from the operator's scope intent. The brief tells the agent *what* to do; the contract is the checklist that proves it *is* done. The skill structurally guarantees the two stay aligned: every Gate in the brief has a VERIFY slot in the contract, and every operator decision-point appears in both.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). If absent, use the defaults named inline below and say so. Keys used:
> - `launch_brief.out_dir` (default `.aiv/launch-briefs/`) - where the two files are written.
> - `launch_brief.pr_classes` (default set below) - the project's PR-class vocabulary; a project may
>   extend it to add classes whose slot bundles live in `CONTRACT-TEMPLATE.md`.
> - `branch.pattern` (default `feat/{stage}-pr-{slug}-{brief}`) - branch the implementing agent will create.
> - `branch.base` (default `origin/main`).
> - `aiv.cli` (default `aiv`) + `aiv.check_cmd` (default `aiv check`) + `aiv.packets_dir`
>   (default `.github/aiv-packets`) - the AIV substrate; the contract's verification floor calls these.
> - `ci.local_replica_cmd`, `ci.test_cmd` (default `npx vitest run`), `ci.e2e_cmd`
>   (default `npx playwright test`) - the project's CI / test / e2e runners.
> - `review.spec_sections` (e.g. `progress_tracker`) - the project's progress-tracker doc section, if any.
> - `review.coord_file` - the multi-PR coordination doc, if any.
> - `memory.dir` (default `auto`) + `memory.index` (default `MEMORY.md`) - project lesson store.
> - `merge.strategy` (default `rebase`) + `merge.autonomous` (MUST be `false`).
>
> Any binding the config does not supply degrades gracefully: a missing `review.coord_file` drops the
> coord-file slot with a one-line note; a missing `ci.local_replica_cmd` drops the pre-push-replica
> gate with a warning; missing `review.spec_sections.progress_tracker` drops the progress-tracker
> closure slot. State which defaults you fell back to.

## Default PR-class vocabulary

When `launch_brief.pr_classes` is unset, use this project-agnostic set. Each class has a slot bundle in `CONTRACT-TEMPLATE.md`:

`migration` / `ui-render` / `dispatcher` / `refactor` / `schema-additive` / `infrastructure` / `test-debt` / `observability` / `docs`.

A project can extend this list via `launch_brief.pr_classes` and supply matching slot bundles. If the operator names a class not in the active vocabulary, surface it and ask whether to add a bundle or pick an existing class.

## When to invoke

- User says "launch brief" (bare or with a scope hint), "new PR brief", "completion contract".
- User says "draft a brief for the next PR", "spin up the launch brief for issue #N", "we need a completion contract for X".
- User identifies a new scope worth a PR and asks for the dispatch artifact.

## When NOT to invoke

- User wants to actually **start work** on a PR - that is the project's start-PR ritual, a separate skill. This skill produces the *prompt* for that ritual.
- User wants to **author or audit an AIV packet** on an open PR - that is the packet-authoring / packet-audit skills.
- User wants to **design tests** for a bug catalog - that is the test-design skill.
- User wants to **review** a PR - that is the review skill.

## Inputs (interactive - drive via AskUserQuestion)

The skill takes an optional argument string from the slash command (e.g. `launch-brief test debt round 2`) and elicits the rest. Required collections:

| Input | How obtained | Notes |
|---|---|---|
| PR ID slug | argument or Q1 | Any project-consistent label (lineage tag or kebab). Goes into filename + branch + banner. |
| One-line scope | argument or Q1 | <=8 words; becomes brief title + contract banner suffix. |
| Issue # being closed | Q2 | `Closes #N` (or a list for a cluster of issues). |
| PR-class tag(s) | Q3 (multi-select) | One or more classes from the active vocabulary. Determines which slots beyond the floor bind. |
| Modifier flags | Q4 (multi-select) | `investigation-first` / `path-fork` / `bisect-needed` / `bug-catalog-first` / `defer-acceptable` / `cluster-issues` / `pre-design-approval`. |
| Stage | Q5 | Branch prefix segment - e.g. `stage-3`. Defaults to a heuristic from `git branch --show-current`. |
| Risk tier | Q6 | R0-R3 with a one-line rationale. Class + flags suggest a default. |
| Iter budget | Q6 | N live-fire cycles pre-authorized. Default by class. |

If the operator pre-staged intel (a failing-files list, a probe log, a walkthrough doc), they typically reference it inline; the skill links it from the brief's "Reading order" + "High-level facts" sections.

## Phases

### Phase 1 - Collect

If invoked bare: open AskUserQuestion with the scope question first (PR ID + one-line scope). Then issue #, then class (multi-select), then flags (multi-select), then stage + risk + iter budget.

If invoked with an argument: parse it for the PR ID + scope, then ask only the remaining gaps. Never ask for what was given.

**Load the project lesson store before composing.** Read the memory index at `memory.dir` (default `auto` = the host's per-project memory dir) named by `memory.index` (default `MEMORY.md`). Surface the project-specific lessons that load-bear on this class in the brief's "Reading order" section. If the store is absent, skip silently - the universal principles below already travel with the skill.

The brief and contract enforce these **universal principles** regardless of any memory store (stated as prose, not as links):

- **Never merge autonomously.** The human is the merge gate (`merge.autonomous` MUST be `false`). Merge via the project's strategy (`merge.strategy`, default `rebase`); never squash if the project preserves atomic history.
- **Local CI before push.** Run the project's local-CI replica (`ci.local_replica_cmd`) before every push; do not push knowing CI will fail.
- **Read the code-review body, not just its status.** A green review status is not the same as zero findings.
- **Never edit a test to make it pass** without first establishing which side is wrong.
- **Deferrals are pinned work, not abandonment.** Every out-of-scope item points to a follow-up (another PR ID, a stage, or an issue #).
- **The packet validates through the tool.** Verification packets pass `aiv.check_cmd` (default `aiv check`); the skill does not restate the spec's header / class-by-tier rules as skill knowledge.

### Phase 2 - Classify

Use the inputs to bind:

- **Floor slots** - always present in contract VERIFY (see `CONTRACT-TEMPLATE.md` Floor).
- **Class-bound slots** - one bundle per class tag (see `CONTRACT-TEMPLATE.md` PR-Classes).
- **Flag-bound slots** - one slot per modifier flag (see `CONTRACT-TEMPLATE.md` Flags).

If `investigation-first` is set BUT no class implies it, surface a soft warning to the operator: "investigation-first in GOAL but no class typically demands it - confirm?"

### Phase 3 - Surface decision-points

Every brief has a "You decide" section listing the choices the implementing agent will make at plan-mode. ENUMERATE these explicitly. Common decision-points by class:

- migration -> forward-only vs retroactive backfill; constraint widening up/down semantics
- ui-render -> which mount/hydration strategy; SPA vs direct-navigation handling
- dispatcher -> enqueue-vs-spawn; idempotency key shape; chain position
- observability -> emit interval; storage substrate
- refactor -> boundary of the public API
- schema-additive -> backfill strategy
- infrastructure -> CI-runner choice; secret distribution
- test-debt -> fix-batch boundary (per file / per category / per root cause); brittle-pin policy
- docs -> source-of-truth boundary; which sections are normative

`path-fork` means at least one decision-point becomes a Path A vs Path B fork with a *path-conditional VERIFY item* in the contract (see `CONTRACT-TEMPLATE.md` Slot operations).

### Phase 4 - Compose the brief

Fill `BRIEF-TEMPLATE.md` by substitution. Required sections:

1. Title (`# PR-{ID} - {scope}`)
2. `## Goal` (1-3 sentences; opens with `Close #N`; optional investigation directive block if `investigation-first` is set)
3. `## High-level facts (verify each yourself)` - bulleted state-of-the-world; include the grep / query / file paths the agent will need. **Variant:** use a table with `# | Item | Status | Code anchor` columns when N sub-items >= 3 and class includes a multi-stream tag (see `BRIEF-TEMPLATE.md` High-level facts as a TABLE).
4. `## You decide` - bulleted decision-points from Phase 3
5. `## Worktree + branch` - boilerplate; the agent runs the start-PR ritual to create the worktree on the branch derived from `branch.pattern`
6. `## Gates (binary)` - bulleted, one bullet per VERIFY slot the contract will assert (alignment by construction)
7. `## Iter budget` - N cycles + escalation path
8. `## When to AskUserQuestion` - bulleted operator-gate triggers
9. `## Risk tier + scope estimate` - R-tier + size by scope (NOT a time estimate)
10. **(Conditional)** `## Conflicts-with check` - if risk_tier in {R2, R3} OR class includes a multi-stream tag. Lists in-flight PRs + issues with hot-zone overlap; clean/check/conflict verdict per row. Pairs with the contract CONFLICTS-WITH RE-VERIFIED slot.
11. `## Out-of-scope` - explicit exclusions; every deferred item pinned to a follow-up (categorical "by-design" boundaries are acceptable without a pin if a rationale is given).
12. `## Reading order before start-PR` - numbered list of files + project lessons
13. **(Conditional)** `## Coord file template` - if risk_tier in {R2, R3} OR multi-checkpoint scope AND `review.coord_file` is configured. Names the path + per-checkpoint content (C1/C2/C3+).
14. Closing line: `Now run the start-PR ritual.`

### Phase 5 - Compose the contract

Fill `CONTRACT-TEMPLATE.md`. The contract is GENERATED FROM the brief: every "Gates (binary)" bullet maps to one or more VERIFY items. Required structure:

- Banner: `===== PR-{ID} COMPLETION CONTRACT - {scope} =====` (5x `=` each side; see template for the exact glyph)
- `GOAL:` block - single paragraph; copy the brief's Goal compressed to <=3 sentences; include `Close #N` and the investigation directive if applicable
- `VERIFY (binary green/red):` block - numbered items `[1]`..`[N]`; SHORT-CAPS title; `cmd:`/`check:`/`drill:` + `pass:` lines
- `PRE-MERGE:` block - 3 bullets minimum; split AskUserQuestion + visual-sign-off if class is ui-render or observability
- `POST-MERGE:` block - 4 categories (bookkeeping / unblock / triggers / retro-verify); fill each or mark N/A
- Optional `OUT-OF-SCOPE REMINDERS:` block if `cluster-issues` is set

VERIFY-slot composition rules:
- Floor slots are emitted in fixed order at the END (typecheck+local-CI -> packet-validates -> no-attribution -> progress-tracker closure -> review-quiet-window -> issue-closed)
- Class-bound slots are emitted FIRST (PR-specific evidence carries more weight than the hygiene floor)
- Investigation slot is `[1]` when `investigation-first` is set
- Anti-regression slot pairs with the relevant patch-landed slot
- Compound `cmd:`+`cmd:` allowed when two checks share semantic meaning
- Path-conditional items use the `Option A: cmd:` ... `Option A pass:` style (see `CONTRACT-TEMPLATE.md`)

### Phase 6 - Lint

Before writing files, check:

1. **Investigation consistency** - if the investigation directive appears in GOAL, contract VERIFY[1] must be the investigation slot. If not, fix or remove the directive.
2. **Class-to-required-slot coverage** - for every class tag, the bundle in `CONTRACT-TEMPLATE.md` PR-Classes must be present. Cross-reference.
3. **Brief Gates -to- Contract VERIFY parity** - every brief Gate has at least one VERIFY item; every VERIFY item beyond the floor has at least one brief Gate. Flag drift.
4. **Operator decisions -to- AskUserQuestion list** - every "You decide" item appears under "When to AskUserQuestion" in the brief.
5. **Out-of-scope follow-up pins** - every "Out-of-scope" bullet points to another PR ID, a known stage, or an issue # (`-> #N`). Bare deferrals are rejected (deferrals are pinned work).
6. **PRE-MERGE gate-graph** - for ui-render or observability class, PRE-MERGE must split AskUserQuestion from visual-sign-off (two parallel gates, not one).
7. **POST-MERGE 4-section coverage** - bookkeeping / unblock / triggers / retro-verify; missing sections must be marked N/A explicitly, not omitted.
8. **Branch name shape** - the value of `branch.pattern` (substituted) appears identically in the brief Worktree+branch section and the contract NO-ATTRIBUTION slot.
9. **Floor calls the substrate via the tool** - the packet-validates slot calls `aiv.check_cmd`, not a restated spec rule. The progress-tracker / coord-file slots reference only configured `review.*` paths, or are dropped with a note when unconfigured.

If any lint check fails, surface the issue to the operator via text BEFORE writing files. Do NOT silently fix; the operator may want to change the input instead.

### Phase 7 - Write

Create the output directory if needed under `launch_brief.out_dir` (default `.aiv/launch-briefs/`), namespaced by slug:

`mkdir -p {out_dir}/pr-{slug}/`

Write both files:
- `{out_dir}/pr-{slug}/pr-{slug}.md`
- `{out_dir}/pr-{slug}/pr-{slug}-completion-contract.md`

If `cluster-issues` is set AND the operator confirms it is actually a wave (>=2 sibling PRs in flight), also write a `_wave-coordination.md` skeleton in the same dir.

Surface the final file paths + a 5-line summary of what was emitted: PR ID, class tags, slot count, total LOC of brief+contract, lint warnings if any.

## Anti-patterns (do not do)

- **Don't average across a corpus.** Each PR is class-specific; emit the slots that fit the class, not a generic catch-all template. Regressing to the mean produces sub-spec contracts.
- **Don't fabricate the "High-level facts" section.** Every fact must be operator-provided OR grep/probe-verifiable. If facts are thin, surface that the brief needs more intel before dispatch.
- **Don't substitute class for flags.** Class describes *what kind of change*; flags describe *how the work proceeds*. A ui-render PR can be `investigation-first` and `path-fork` simultaneously.
- **Don't omit the lint pass.** It is the structural integrity check that separates a real brief from a template fill-in.
- **Don't write the start-PR invocation inside the brief.** The brief ends with `Now run the start-PR ritual.` - the agent invokes it themselves.
- **Don't restate AIV spec rules as skill knowledge.** The contract's packet slot calls `aiv check` and reads its output; it does not transcribe header strings or class-by-tier tables.
- **Don't add tool/agent authorship attribution to commits.**
- **Don't use emojis** in the brief/contract unless the operator requested them. The investigation sigil and the clean/check/conflict verdict glyphs are the only sanctioned structural markers, not decoration.

## Reading order before composing

1. This SKILL.md (you are here)
2. `BRIEF-TEMPLATE.md` (skeleton + placeholder semantics)
3. `CONTRACT-TEMPLATE.md` (skeleton + floor + class-bound slots + flag-bound slots + slot operations + lint rules)
4. The project config `.aiv-workflow.yml` (bindings; degrade gracefully where absent)
5. The project lesson store at `memory.dir`/`memory.index`, if present (load class-relevant entries)
