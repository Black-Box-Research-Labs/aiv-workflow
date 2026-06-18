# Launch brief template

Substitution model: `{{PLACEHOLDER}}` markers are filled by the skill from collected inputs. Sections marked `[optional - emit only if {{flag}}]` are conditional. Sections marked `[required]` are always emitted.

The template is class-driven: emit the sections that fit the PR's class + flags, not a fixed superset. The structural features (investigation block, conflicts-with table, coord file) are first-class for R2-R3 multi-stream PRs and omitted otherwise.

All project facts come from `.aiv-workflow.yml` (see SKILL.md "Config"). Notably:
- the issue URL host is derived from the repo's `origin` remote, not hardcoded;
- the branch is `branch.pattern` substituted with `{stage}`, `{slug}`, `{brief}`;
- the coord-file and progress-tracker references come from `review.coord_file` / `review.spec_sections` and are dropped (with a one-line note) when unconfigured.

---

## TEMPLATE

```markdown
# PR-{{ID}} - {{ONE_LINE_SCOPE}}

## Goal

Close #{{ISSUE_N}}{{#if CLUSTER_ISSUES}} + {{ISSUE_LIST}}{{/if}} - {{GOAL_PARAGRAPH}}.

{{#if SECONDARY_FRAMING}}
{{SECONDARY_FRAMING_PARAGRAPH}}
{{/if}}

{{#if INVESTIGATION_FIRST}}
## Investigation directive - {{INVESTIGATION_HEADLINE}}

{{INVESTIGATION_RATIONALE}}

**Hypothesis space:**

1. **({{H1_TAG}}) {{H1_NAME}}** - {{H1_DESC}}
2. **({{H2_TAG}}) {{H2_NAME}}** - {{H2_DESC}}
{{#each ADDITIONAL_HYPOTHESES}}
{{INDEX}}. **({{TAG}}) {{NAME}}** - {{DESC}}
{{/each}}

**Mandatory pre-patch protocol:**

1. {{INVESTIGATION_STEP_1}}
2. {{INVESTIGATION_STEP_2}}
{{#each ADDITIONAL_STEPS}}
{{INDEX}}. {{STEP}}
{{/each}}

Hypothesis ranking + diagnostic evidence -> AskUserQuestion thread + operator confirmation BEFORE first implementation commit{{#if DEFER_ACCEPTABLE}}; DEFER-with-issue-pin is a valid outcome if the investigation reveals the change should not ship{{/if}}.
{{/if}}

## High-level facts (verify each yourself)

{{#each FACTS}}
- {{FACT}}
{{/each}}

## You decide{{#if AT_PLAN_MODE}} (at plan-mode + via AskUserQuestion){{/if}}

{{#each DECISIONS}}
- **{{DECISION_NAME}}** - {{DECISION_DESC}}
{{/each}}

## Worktree + branch

The start-PR ritual creates the worktree on `{{BRANCH}}` (from `branch.pattern`) off `{{BASE}}` (`branch.base`, default `origin/main`).{{#if CLUSTER_SIBLINGS}} Coordinate with {{SIBLING_LIST}} via the coord file - file hot zones {{HOT_ZONE_STATUS}}.{{/if}}

## Gates (binary)

- **start-PR ritual mandatory**
{{#if INVESTIGATION_FIRST}}
- **Investigation surfaced via AskUserQuestion BEFORE patch** ({{INVESTIGATION_PROTOCOL_REF}})
{{/if}}
{{#if PRE_DESIGN_APPROVAL}}
- **Coverage matrix / design operator-approved BEFORE code volume** - design doc / table posted to PR body; operator-comment confirms before {{CODE_VOLUME_THRESHOLD}}
{{/if}}
- **Atomic-commit policy honored; verification packet passes `aiv check`; no authorship attribution on commits; no `--no-verify`{{#if ADMITS_AMEND_AS_BYPASS}}/`--amend`{{/if}} outside an authorized exception**
- **Lint exit 0** {{LINT_BASELINE_NOTE}}
- **Typecheck exit 0** {{TSC_BASELINE_NOTE}}
{{#each CLASS_GATES}}
- **{{GATE_TITLE}}** - {{GATE_DESC}}
{{/each}}
- **Iter#{{ITER_NUM}} live-fire** - {{ITER_DESC}}
{{#if UI_RENDER_CLASS}}
- **Production verification post-merge** - operator confirms {{UI_VERIFICATION_DESC}} (operator visual sign-off - UI PR)
{{/if}}
- **Local-CI replica green before push** (`ci.local_replica_cmd`)
- **Review quiet-window cleared pre-merge**
- **Never autonomous merge** - operator merges via the project's strategy (`merge.strategy`)
- **Issue #{{ISSUE_N}} closure** - final commit references "Closes #{{ISSUE_N}}"{{#if CLUSTER_ISSUES}} + {{CLOSES_BLOCK}}{{/if}}
{{#if COORD_FILE}}
- **Coord file** {{N_CHECKPOINTS}} checkpoints in `{{COORD_FILE}}`
{{/if}}
{{#if PROGRESS_TRACKER}}
- **Progress-tracker closure** - register row `{{INVENTORY_ROW_ID}}` in {{PROGRESS_TRACKER}} with merge SHA
{{/if}}

## Iter budget

**{{ITER_BUDGET_N}} live-fire iter cycle{{#if PLURAL}}s{{/if}} pre-authorized.** {{ITER_RATIONALE}}. Surface +N via AskUserQuestion if scope grows.

## When to AskUserQuestion

{{#each ASKUSER_TRIGGERS}}
- {{TRIGGER}}
{{/each}}
- Before merge - review quiet-window check{{#if UI_RENDER_CLASS}} + production visual sign-off ask{{/if}}

## Risk tier + scope estimate

- **Risk: {{RISK_TIER}}** ({{RISK_RATIONALE}})
- **Scope: {{SCOPE_ESTIMATE}}** - {{SCOPE_BREAKDOWN}} (size by scope, NOT a time estimate)

## Out-of-scope

{{#each OUT_OF_SCOPE}}
- {{ITEM}}{{#if PIN}} -> {{PIN}}{{/if}}
{{/each}}

## Reading order before start-PR

1. This brief + completion contract
{{#each ADDITIONAL_READING}}
{{INDEX}}. {{ITEM}}
{{/each}}
{{#if PROJECT_LESSONS}}
{{LESSON_INDEX}}. Project lessons: {{LESSON_LIST}}
{{/if}}

Now run the start-PR ritual.
```

---

## Placeholder semantics

### Required

| Placeholder | Source | Example |
|---|---|---|
| `{{ID}}` | input PR ID | any project-consistent label or kebab |
| `{{ONE_LINE_SCOPE}}` | input scope | `Test debt consolidation (213 failures across 45 files)` |
| `{{ISSUE_N}}` | input issue # | `322` |
| `{{GOAL_PARAGRAPH}}` | operator-supplied (or elicited) | the 1-2 sentence statement of what the PR closes |
| `{{SLUG}}` | derived from ID | kebab-case, ASCII |
| `{{STAGE}}` | input stage | branch prefix segment, e.g. `stage-3` |
| `{{BRIEF_BRANCH}}` | derived from scope | kebab; <=4 words; `test-debt`, `findings-projection` |
| `{{BRANCH}}` | `branch.pattern` substituted | default pattern `feat/{stage}-pr-{slug}-{brief}` |
| `{{BASE}}` | `branch.base` | default `origin/main` |
| `{{INVENTORY_ROW_ID}}` | input (if progress tracker configured) | a tracker row id |
| `{{ITER_NUM}}` | input | typically tracks `{{ID}}` |
| `{{ITER_BUDGET_N}}` | input | `1`, `2`, `3-5` |
| `{{RISK_TIER}}` | input | `R0`, `R1`, `R1-R2`, `R2`, `R3` |

### Conditional

| Placeholder | Condition |
|---|---|
| `{{INVESTIGATION_HEADLINE}}` etc. | `investigation-first` flag set |
| `{{SIBLING_LIST}}`, `{{HOT_ZONE_STATUS}}` | `cluster-siblings` or wave-coordination |
| `{{CLOSES_BLOCK}}` | `cluster-issues` (multi-issue close) |
| `{{UI_VERIFICATION_DESC}}` | `ui-render` class |
| `{{PRE_DESIGN_APPROVAL}}` block | `pre-design-approval` flag |
| `{{LINT_BASELINE_NOTE}}` | "already green; maintain" if baseline is clean, else "fix to green" |
| `{{COORD_FILE}}` | `review.coord_file` is configured |
| `{{PROGRESS_TRACKER}}`, `{{INVENTORY_ROW_ID}}` | `review.spec_sections.progress_tracker` is configured |

### Decisions list - class defaults

The skill seeds `{{DECISIONS}}` with class-default entries the operator can edit:

- migration -> "Forward-only vs retroactive backfill"; "Constraint widening up/down semantics"
- ui-render -> "Mount/hydration strategy"; "SPA navigation vs direct-load handling"
- dispatcher -> "Idempotency key shape"; "Chain position (terminal vs mid)"
- observability -> "Emit interval"; "Storage substrate"
- refactor -> "Public API boundary"
- schema-additive -> "Backfill strategy"
- infrastructure -> "Runner choice"; "Secret distribution"
- test-debt -> "Fix-batch boundary (per file / per category / per root cause)"; "Brittle-pin policy (bump vs flexible assertion)"
- docs -> "Source-of-truth boundary"; "Which sections are normative"

### Project lessons - class defaults

The brief links the project's lesson store entries (loaded from `memory.dir`/`memory.index`) relevant to the class. These are project-specific by nature and resolve only on the host project; the skill lists whatever the store provides and omits the section if the store is absent. The **universal** principles (no autonomous merge, local-CI before push, read the review body, never edit a test to pass, deferrals are pinned, packet passes `aiv check`) are already inlined in the contract floor and the brief Gates - they do not depend on the store.

Map class -> lesson-topic the brief should surface (the skill resolves these against the actual store; missing entries are skipped):

| Class | Lesson topics to surface (if present in the store) |
|---|---|
| migration | DB-surrogate-not-sufficient; check-state-before-acting |
| ui-render | routing-collision; background-tab timer throttling |
| dispatcher | step logging; sidecar-is-audit |
| observability | don't-defer-when-downstream-exists; long-running-not-wedge |
| refactor | refactor test-coverage |
| schema-additive | DB-surrogate-not-sufficient; check-state-before-acting |
| infrastructure | CI-hardening state; CI self-host resolution |
| test-debt | test-failure-default; no-deferred-bugs |
| docs | (usually none) |

---

## Optional sections (class- and tier-bound)

Add these sections AFTER the Reading-order section and BEFORE the closing line when their triggers fire.

### `## Conflicts-with check`

**Trigger:** risk_tier in {R2, R3} OR class includes a multi-stream tag OR operator-flagged multi-stream. Lists every in-flight or recently-merged PR + open issue whose file hot-zones overlap. Each row marked clean / check / conflict, with a specific verify-before-first-commit action for non-clean rows.

```markdown
## Conflicts-with check

- **PR #{{N}} ({{NAME}})** - touches {{HOT_ZONES}}. {{OVERLAP_ASSESSMENT}}. {{VERDICT}} {{ACTION_IF_NOT_CLEAN}}
- ...
```

Verdict labels: clean / check / conflict (these are sanctioned structural markers).

### `## Coord file template`

**Trigger:** (risk_tier in {R2, R3} OR class includes a multi-stream tag OR operator-flagged multi-checkpoint) AND `review.coord_file` is configured. Names the coord file path + enumerates checkpoints with the content each must carry. If `review.coord_file` is unset, drop this section with a one-line note.

```markdown
## Coord file template

`{{COORD_FILE}}` - N checkpoints:
- C1: post-investigation, pre-first-commit ({{Q_LIST_RESOLVED_CONDITION}})
- C2: mid-PR ({{MID_PR_GATE}})
- C3: pre-merge (all streams merged; review quiet-window cleared; progress-tracker closure ready)
```

### High-level facts as a TABLE (variant)

**Trigger:** N improvements / sub-items / streams >= 3 AND class includes a multi-stream tag. Replaces the bulleted prose with a table:

```markdown
## High-level facts (verify each yourself)

| # | Item | Status | Code anchor |
|---|---|---|---|
| 1 | {{ITEM_1}} | {{STATUS}} | {{ANCHOR}} |
| ... |
```

Status indicators: text labels `shipped` / `partial` / `not-started` / `blocked`. Avoid color emojis unless the operator explicitly approves them.

Add an `**Empirical signals from transcripts/probes/walkthroughs:**` bulleted section below the table when the facts derive from operator-observed evidence.

---

## Brief-to-Contract alignment requirement

After Phase-4 brief generation, every `## Gates (binary)` bullet MUST correspond to at least one VERIFY slot in the contract (Phase 5). Lint enforces this in Phase 6.

Conversely: every contract VERIFY slot beyond the floor MUST correspond to a Gate bullet OR a `## You decide` decision-point in the brief. (Operator decisions that change the implementation produce VERIFY items confirming the decision was made + the chosen path applied.)

This alignment is the structural integrity check. A brief without its companion contract is incomplete; a contract without its brief is unanchored.
