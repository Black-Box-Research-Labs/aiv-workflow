# Completion contract template

The contract is the binary green/red merge gate. It is composed by selecting slots from three layers:

1. **Floor** - always emitted (hygiene + AIV packet validation + issue close + review quiet-window)
2. **Class-bound** - emitted based on PR-class tag(s)
3. **Flag-bound** - emitted based on modifier flags

Slots can be combined via **slot operations**: compound, path-conditional, anti-regression, empirical-threshold, multi-environment-probe, defer-acceptable.

All project facts come from `.aiv-workflow.yml` (see SKILL.md "Config"). The substrate slot (packet validation) calls `aiv.check_cmd` (default `aiv check`) and reads its output - it does NOT restate the spec's header strings or class-by-tier rules. Database connection strings, environment names, runner names, doc paths are placeholders the skill fills from config or from operator-supplied facts; nothing is hardcoded.

---

## Skeleton (always emitted)

```
===== PR-{{ID}} COMPLETION CONTRACT - {{ONE_LINE_SCOPE}} =====

GOAL: {{GOAL_PARAGRAPH_COMPRESSED}}{{#if INVESTIGATION_FIRST}} INVESTIGATION-FIRST: {{INVESTIGATION_HEADLINE_SHORT}}{{/if}}.

VERIFY (binary green/red):

{{INVESTIGATION_SLOT_IF_FLAG_SET}}

{{CLASS_BOUND_SLOTS}}

{{FLAG_BOUND_SLOTS}}

{{FLOOR_SLOTS}}

PRE-MERGE:
{{PRE_MERGE_GATE_GRAPH}}

POST-MERGE:
{{POST_MERGE_FOUR_SECTIONS}}

{{#if CLUSTER_ISSUES}}
OUT-OF-SCOPE REMINDERS (do NOT silently fix):
{{OUT_OF_SCOPE_PINNED_ITEMS}}
{{/if}}
```

Banner uses U+2550 `=` (the box-drawing double-horizontal) x 5 on each side. Closing mirrors opening. No blank line between banner and `GOAL:`.

---

## Floor slots (always emitted, in this order, at the END of VERIFY)

### F1 - TYPECHECK + LOCAL-CI

```
[N] TYPECHECK + LOCAL-CI
  cmd: {{TYPECHECK_CMD}} && {{TEST_CMD}} {{TOUCHED_SPEC_PATHS}}
  pass: exit 0
```

`{{TEST_CMD}}` is `ci.test_cmd` (default `npx vitest run`). `{{TYPECHECK_CMD}}` is the project's typecheck (auto-detect, e.g. `tsc --noEmit`; drop if no typed language). `{{TOUCHED_SPEC_PATHS}}` is the space-separated list of spec files touched by the PR - keep tight; do NOT run the full suite by default.

### F2 - PACKET VALIDATES (AIV substrate via tool)

```
[N] PACKET VALIDATES
  cmd: {{AIV_CHECK_CMD}} {{PACKETS_DIR}}/VERIFICATION_PACKET_PR_{{ID_UPPER}}_*.md
  pass: aiv check exits 0 for every packet{{#if CLUSTER}}; OR an authorized exception documents the bulk-pattern authorization{{/if}}
```

`{{AIV_CHECK_CMD}}` is `aiv.check_cmd` (default `aiv check`); `{{PACKETS_DIR}}` is `aiv.packets_dir` (default `.github/aiv-packets`). The contract relies on the tool's verdict, not on a restated spec rule.

### F3 - NO ATTRIBUTION / NO BYPASS (track-aware)

Emit per `launch_brief.track`. On a `human` track the slot asserts both no tool/agent attribution and no bypass flags:

```
[N] NO ATTRIBUTION / NO BYPASS{{#if CLUSTER}} (outside authorized exception scope){{/if}}
  cmd: git log {{BASE}}..HEAD --pretty=format:'%B' | grep -cE -- 'Co-Authored-By|--no-verify|--amend'
  pass: 0 matches
```

On an `ai-driven` track agent authorship is the expected state, so the slot **drops the attribution check** and asserts NO BYPASS only:

```
[N] NO BYPASS{{#if CLUSTER}} (outside authorized exception scope){{/if}}
  cmd: git log {{BASE}}..HEAD --pretty=format:'%B' | grep -cE -- '--no-verify|--amend'
  pass: 0 matches
```

`{{BASE}}` is `branch.base` (default `origin/main`). The range anchors on the merge-base, **not** a branch-name literal: the harness owns the branch name, so it is non-load-bearing (see lint rule 8). Never emit a "no AI author" pass-condition on the `ai-driven` track - it would fail every autonomous PR by construction.

### F4 - PROGRESS-TRACKER CLOSURE + COORD FILE

**Emit only if `review.spec_sections.progress_tracker` and/or `review.coord_file` are configured.** Drop with a one-line note otherwise.

```
[N] PROGRESS-TRACKER CLOSURE{{#if COORD_FILE}} + COORD FILE{{/if}}
  check: grep "{{ID}}" {{PROGRESS_TRACKER_DOC}}{{#if COORD_FILE}} ; grep "{{ID_REGEX}}" {{COORD_FILE}}{{/if}}
  pass: row {{INVENTORY_ROW_ID}} annotated with PR-{{ID}} SHA{{#if COORD_FILE}}; coord row present{{/if}}
```

`{{PROGRESS_TRACKER_DOC}}` derives from `review.spec_sections.progress_tracker`; `{{COORD_FILE}}` from `review.coord_file`. `{{ID_REGEX}}` is the ID with regex-escaped dots.

### F5 - REVIEW QUIET-WINDOW + CONVERGENCE

```
[N] REVIEW QUIET-WINDOW + CONVERGENCE
  cmd: gh pr view <N> --json reviews --jq '.reviews[-1] | (.body[:120] + " | submittedAt=" + .submittedAt)'
  pass: latest automated-review body shows zero actionable comments AND the quiet window has elapsed since the last review
```

Read the review *body*, not just its status - a green status is not zero findings.

### F6 - ISSUE CLOSED

```
[N] ISSUE CLOSED
  cmd: gh pr view <N> --json body --jq '.body' | grep -E "Closes #[0-9]+"
  pass: PR body references "Closes #{{ISSUE_N}}"{{#if CLUSTER_ISSUES}} for each of {{ISSUE_LIST}}{{/if}}
```

---

## Authoring rule — the fix VERIFY item must grade the OUTCOME, not a locked fix-approach (XOR-safe)

The contract is authored HERE, at launch-brief, but the fix APPROACH is chosen later (at design-tests/write-code).
So a finding-specific VERIFY item must NOT pre-commit to one branch of a fix that has more than one valid approach
("change the sampler to emit the runner's keys" **OR** "change the runner to read the sampler's keys"). If you emit
BOTH branches as separate binary-required items, the branch NOT taken is falsifiable-by-construction and the review
oscillates forever (observed: F004 locked approach A as items [2]/[3]; write-code took approach B; or-review
correctly falsified the road-not-taken items and the drive could never converge).

Rules for the load-bearing fix item(s):

1. **Emit ONE load-bearing OUTCOME item that runs the finding's `goal_condition`** — approach-agnostic, satisfied by
   ANY valid fix. Make its `pass:` MACHINE-EVALUABLE (`exit 0`, `0 matches`, `>=N matches`, `exactly N`), never prose:

   ```
   [N] DEFECT RESOLVED (goal_condition) — approach-agnostic
     cmd: {{GOAL_CONDITION_REPRO_CMD}}   # the finding's own "when is it fixed" repro, run at HEAD
     pass: exit 0
   ```

2. **Fix-MECHANISM greps** (which file has which key/pattern) are legitimate for surfacing adjacent sites, but when
   the approach is an XOR they are NOT binary-required — emit them tagged `advisory:` so a road-not-taken branch does
   not falsify the PR. A single chosen-approach "LANDED" check (`grep ... / pass: >=1 match`, like the `ui-render`
   class) is fine; TWO mutually-exclusive branch checks as `pass:` items are the bug.

3. Keep every finding-specific `pass:` machine-evaluable so the harness can deterministically re-grade the contract
   (fix_pipeline `#191`): the harness reclassifies a failing mechanism grep as advisory when the seam proves the
   outcome, but ONLY if the whole contract is machine-evaluable — a prose `pass:` disables that safety net.

4. **Track-awareness (D-5) — never assert a human act as a live `pass:` on the `ai-driven` track.** The human's only
   acts are H1 (the finding) and H2 (judge + merge); there is NO live operator-approval event mid-drive. So an item
   like `pass: … operator approval BEFORE first impl commit` is unsatisfiable autonomously and blocks convergence
   forever (same class as the already-forbidden "no AI commit author" pass-condition). On the `ai-driven` track,
   assert only the machine-verifiable part (e.g. "an investigation section is present in the PR body/plan":
   `grep -c` / `pass: >=1`); record any genuine human judgment-call as an H2-adjudicable note (`contract_na`), never
   as a live gate.

5. **Finding-source-awareness (D-6) — do not emit a human-GitHub-workflow gate that cannot apply to THIS finding.**
   When the finding is a **synthetic / audit-derived** finding (its `intentSource` is an audit doc, not a GitHub
   issue number), `Closes #<id>` can never appear in the PR body — `#F004` is not an issue — so the **ISSUE-CLOSED**
   floor slot (F6) must be `contract_na` (H2 bookkeeping), not a live gate; emit it as a note, or drop it. Likewise
   the **REVIEW-QUIET-WINDOW / CONVERGENCE** slot (F5) is the TERMINATOR's job (STABLE_N rounds at the same head),
   not a model-graded contract item — it is circular at review time and (being prose) also disables the harness's
   deterministic contract re-grade (`#191`). On an autonomous synthetic-finding drive, drop F5 as a VERIFY item or
   mark it `contract_na`. Rule of thumb: every RETAINED VERIFY item must be machine-evaluable AND satisfiable by the
   autonomous flow; anything keyed to a human GitHub action goes to `contract_na`.

## PR-Classes (class-bound slots, emitted before floor)

The default vocabulary is project-agnostic. A project may add classes via `launch_brief.pr_classes`; supply the new class's slot bundle here in the project's fork.

### migration

```
[N] PRE-PATCH PROBE CONFIRMS GAP
  cmd: {{DB_PROBE_CMD}} -c "{{PROBE_QUERY}}"
  pass: {{GAP_CONFIRMATION_CONDITION}}

[N] MIGRATION FILE EXISTS
  cmd: ls {{MIGRATIONS_DIR}}/*{{KEYWORD}}*.sql 2>&1
  pass: exactly 1 migration file with the appropriate slot number

[N] MIGRATION UP/DOWN PAIR
  cmd: grep -cE "{{UP_PATTERN}}|{{DOWN_PATTERN}}" {{MIGRATIONS_DIR}}/*{{KEYWORD}}*.sql
  pass: >=2 (one up + one down); DOWN section restores the prior shape

[N] MIGRATION APPLIED TO TARGET ENVIRONMENT
  cmd: {{DB_PROBE_CMD}} -c "{{POST_APPLY_PROBE}}"
  pass: {{POST_APPLY_CONDITION}}

[N] SMOKE TEST {{TYPE}} INSERT
  cmd: {{DB_PROBE_CMD}} -c "{{SMOKE_INSERT}}"
  pass: INSERT succeeds (no constraint violation); cleanup DELETE succeeds
```

Pairs with the multi-environment-probe slot operation if the project has more than one DB environment.

### ui-render

```
[N] {{FIX_APPROACH_NAME}} LANDED - {{COMPONENT_PATH}}
  cmd: grep -nE "{{PATTERN}}" {{COMPONENT_FILE}}
  pass: >=1 match showing {{PATTERN_SEMANTIC}}

[N] E2E VERIFICATION - {{ROUTE}} POPULATES WITHIN {{N}}S
  check: e2e spec ({{E2E_CMD}}) asserts {{ASSERTION}}
  pass: spec passes; PR body screenshot evidence

[N] NO REGRESSION ON {{BASELINE_ROUTE}} INITIAL LOAD
  cmd: e2e spec asserts {{BASELINE_ROUTE}} loads cleanly (no {{BUG_REF}} reproduces)
  pass: spec passes (verifies the PR didn't break the working path)

[N] COMPONENT SPEC COVERAGE
  cmd: {{TEST_CMD}} {{COMPONENT_SPEC_PATH}}
  pass: exit 0 ; spec asserts {{BEHAVIOR}}

[N] OPERATOR VISUAL SIGN-OFF
  cmd: gh pr view <N> --json comments --jq '.comments[].body' | grep -iE "VISUAL SIGN-OFF|approved"
  pass: >=1 operator-comment with explicit sign-off post-screenshots; >={{N_SCREENSHOTS}} screenshots posted (>=1 per surface)
```

`{{E2E_CMD}}` is `ci.e2e_cmd` (default `npx playwright test`); `{{TEST_CMD}}` is `ci.test_cmd`.

### dispatcher

```
[N] DISPATCHER OR STEP LANDED
  cmd: ls {{DISPATCHER_PATH}}
  pass: file exists; registered in the job claim filter (grep the worker for the jobType)

[N] CORRELATION-ID PROPAGATION
  cmd: {{DB_PROBE_CMD}} -c "SELECT type, count(*) FILTER (WHERE {{CORRELATION_FIELD}} IS NOT NULL) AS with_id, count(*) AS total FROM {{JOBS_TABLE}} WHERE {{ENQUEUED_RECENT}} GROUP BY type;"
  pass: post-iter#{{ITER_NUM}} all dispatcher types show with_id = total (no NULLs)

[N] PHASE/STATE COLUMN POPULATED
  cmd: {{DB_PROBE_CMD}} -t -A -c "SELECT {{PHASE_COL}}, count(*) FROM {{JOBS_TABLE}} WHERE {{CORRELATION_FIELD}}=<iter{{ITER_NUM}}_id> GROUP BY {{PHASE_COL}};"
  pass: 0 'unknown' rows; phase taxonomy per-dispatcher

[N] WRITER EXTENSION
  cmd: grep -nE "{{NEW_FIELDS}}" {{WRITER_INTERFACE}} {{WRITER_IMPL}}
  pass: writer signature accepts new fields; backward-compat (optional params)

[N] DISPATCHER SPEC PINNED
  cmd: {{TEST_CMD}} {{DISPATCHER_SPEC_PATH}} -t "{{TEST_PATTERN}}"
  pass: new test asserts {{ASSERTION}}; exit 0
```

### refactor

```
[N] BEHAVIOR-PINNING TESTS LANDED BEFORE REFACTOR
  cmd: git log --reverse --format='%H %s' -- {{TARGET_FILE}}.spec.{{EXT}} {{TARGET_FILE}}.{{EXT}} | head -2
  pass: spec commit precedes refactor commit; spec asserts pre-refactor behavior pinned

[N] EXISTING TESTS REMAIN GREEN (no behavior drift)
  cmd: {{TEST_CMD}} {{TARGET_AREA}}
  pass: exit 0 ; no tests skipped or deleted vs the pre-refactor baseline

[N] PUBLIC API BOUNDARY DOCUMENTED
  check: PR body lists every exported symbol from {{MODULE}} with before/after signature
  pass: section present; operator-confirmed no consumer broken
```

### schema-additive

```
[N] COLUMN / TABLE EXISTS
  cmd: {{DB_PROBE_CMD}} -c "SELECT column_name FROM information_schema.columns WHERE table_name='{{TABLE}}' AND column_name='{{COL}}';"
  pass: column exists

[N] WRITER SETS NEW FIELD
  cmd: {{DB_PROBE_CMD}} -c "SELECT {{COL}} FROM {{TABLE}} ORDER BY {{CREATED_COL}} DESC LIMIT 1;"
  pass: value matches the expected default / format

[N] DATA-ACCESS METHOD
  cmd: grep -nE "{{DAL_METHOD}}" {{WRITER_INTERFACE}} {{WRITER_IMPL}}
  pass: >=2 matches (interface contract + impl); typed return shape documented

[N] DDL APPLIED TO ALL ENVIRONMENTS
  cmd: {{MULTI_ENV_DDL_PROBE}}
  pass: table/column exists on every target environment
```

### infrastructure

```
[N] CI RUN GREEN ON NEW BRANCH
  check: gh pr checks <N> --watch shows all required checks SUCCESS
  pass: all required checks green

[N] NO REGRESSION ON EXISTING WORKFLOWS
  cmd: gh run list --workflow={{OTHER_WORKFLOW}} --limit 5 --json conclusion --jq '[.[].conclusion] | unique'
  pass: only ["success"] or ["success", "skipped"]

[N] SECRET / ENV VAR ROTATION DOCUMENTED
  check: {{RUNBOOK_PATH}} updated with the new secret name + rotation procedure
  pass: file exists with the section heading
```

### test-debt

```
[N] INVESTIGATION CATEGORIZATION SURFACED BEFORE PATCH
  check: PR body has an investigation section grouping {{N_FAILURES}} failures by ROOT CAUSE (not by file). Expected categories: {{CATEGORY_LIST}}
  pass: >={{N_CATEGORIES}} categories with file-count per category + AskUserQuestion thread approving the fix strategy

[N] TESTS GREEN
  cmd: {{TEST_CMD}}
  pass: exit 0; >={{BASELINE_PASS_COUNT}} passed + 0 failed (matching pre-debt baseline)

[N] BRITTLE PIN POLICY APPLIED ({{PATTERN_DESC}})
  cmd: grep -nE "{{BRITTLE_PATTERN}}" {{SCAN_PATHS}}
  pass: either pin updated to current count OR replaced with a `>=N` flexible assertion; operator-approved policy documented in PR body

[N] CI GREEN (PR's own CI)
  check: gh pr checks <N> --watch shows all required checks SUCCESS; test job shows >={{BASELINE_PASS_COUNT}} passed
  pass: all required checks green on the new branch

[N] SKIPPED TESTS PINNED TO ISSUE
  cmd: grep -rnE "\.skip\(|\.skipIf\(|@.*-skip" {{TEST_SCAN_PATHS}}
  pass: every skip annotation references a follow-up issue # (deferrals are pinned work); 0 bare skips
```

### observability

```
[N] HEARTBEAT / EMIT MECHANISM PRESENT
  cmd: grep -nE "setInterval|heartbeat|keep-alive" {{HANDLER_PATH}}
  pass: >=1 match; interval <= the proxy/timeout ceiling so intermediate proxies don't terminate the stream

[N] LIVE-FIRE - STREAM/EMITTER STAYS OPEN >{{N}}S
  check: PR body includes evidence of a test dispatch + the stream stayed open >{{N}}s while events streamed
  pass: >={{N_EVENTS}} distinct events received client-side within {{N}}s wallclock

[N] NO REGRESSION ON {{OTHER_CONSUMERS}}
  cmd: grep -rE "{{CONSUMER_PATTERN}}" {{CONSUMER_SCAN_PATHS}}
  pass: identify all consumers; spec verifies they still work post-fix

[N] SPEC COVERAGE
  cmd: {{TEST_CMD}} {{HANDLER_SPEC_PATH}}
  pass: spec asserts the handler keeps the response open under continuous event flow + heartbeat fires + the auth/middleware layer doesn't terminate the stream prematurely
```

### docs

```
[N] SOURCE-OF-TRUTH BOUNDARY HONORED
  check: PR body names which sections are normative vs descriptive; no normative claim duplicated across two docs
  pass: boundary stated; no contradictory duplicate

[N] LINKS RESOLVE
  cmd: {{LINK_CHECK_CMD}}
  pass: 0 broken internal links

[N] NO STALE CODE REFERENCES
  cmd: grep -nE "{{REFERENCED_SYMBOLS}}" docs/ && {{VERIFY_SYMBOLS_EXIST_CMD}}
  pass: every code symbol/path referenced in the changed docs still exists
```

### e2e-harness

```
[N] COST MODEL DOCUMENTED
  check: PR body (or {{RUNBOOK_PATH}}) states the per-run + projected recurring cost of the harness (runner minutes, external-service calls, storage)
  pass: cost section present with a concrete number, not "TBD"

[N] FAILURE-NOTIFICATION DEMONSTRATED
  check: PR body includes evidence of an induced failure routing to the configured notification surface ({{NOTIFY_CHANNEL}})
  pass: >=1 captured notification from a deliberately-failed run

[N] TRIGGER SURFACE WIRED
  cmd: grep -nE "{{TRIGGER_PATTERN}}" {{HARNESS_CONFIG}}
  pass: >=1 match showing the harness fires on its intended trigger (schedule / event / manual dispatch)

[N] SECRET-NEVER-COMMITTED
  cmd: git log -S '{{SECRET_TOKEN_NAME}}' {{BRANCH}}...
  pass: 0 hits (the secret is referenced only by env/secret-store name, never as a literal value)
```

`{{NOTIFY_CHANNEL}}` and `{{TRIGGER_PATTERN}}`/`{{HARNESS_CONFIG}}` come from the project's facts/config. The SECRET-NEVER-COMMITTED check substitutes `{{SECRET_TOKEN_NAME}}` with each secret the harness consumes (run once per secret).

---

## Flags (flag-bound slots)

### investigation-first

Emit as **[1]** (FIRST slot in VERIFY):

```
[1] INVESTIGATION SURFACED BEFORE PATCH
  check: PR body has an investigation section ({{HYPOTHESIS_COUNT}}-hypothesis diagnostic with evidence per candidate + ranking + recommendation{{#if BUG_CATALOG_FIRST}} + git blame + git log -S "{{KEYWORD}}" results{{/if}})
  pass: present; AskUserQuestion thread{{#if PATH_FORK}} approving the locked path{{/if}}; operator approval BEFORE first impl commit{{#if DEFER_ACCEPTABLE}}; DEFER-with-issue-pin acceptable outcome{{/if}}
```

### path-fork (Path A vs Path B)

Replace one VERIFY slot (typically the "patch landed" slot) with a path-conditional variant:

```
[N] {{FIX_APPROACH_NAME}} LANDED ({{PATH_A_NAME}}) OR {{FIX_APPROACH_ALT}} LANDED ({{PATH_B_NAME}})
  cmd: ({{PATH_A_NAME}}) {{PATH_A_CMD}}
  cmd: ({{PATH_B_NAME}}) {{PATH_B_CMD}}
  pass: {{PATH_A_NAME}} -> {{PATH_A_PASS}}; {{PATH_B_NAME}} -> {{PATH_B_PASS}}
```

Also add a **PATH DECISION SURFACED + APPROVED** slot if not already covered by investigation-first:

```
[N] PATH DECISION SURFACED + APPROVED
  check: PR body has a "{{PATH_A_NAME}} vs {{PATH_B_NAME}}" section with rationale + AskUserQuestion thread + operator approval BEFORE first implementation commit
  pass: present; thread documented; operator-approved path locked in PR body
```

### bisect-needed (regression from a known-good state)

Emit immediately after the investigation slot:

```
[N] BISECT DOCUMENTED
  cmd: git log --oneline --since="{{SINCE_DATE}}" --until="{{UNTIL_DATE}}" -- {{TOUCHED_PATHS}}
  pass: PR body cites the bisect-identified commit SHA(s) + git show output evidence
```

### bug-catalog-first

Emit before the spec-coverage slot:

```
[N] BUG-CATALOG FIRST
  cmd: git log --reverse --format='%H %s' -- {{TARGET_FILE}}.bug-catalog.md {{TARGET_FILE}}.{{EXT}} | head -2
  pass: catalog commit precedes the spec/implementation commit
```

### defer-acceptable

Modify the investigation slot's `pass:` line:

```
... pass: present; AskUserQuestion thread; operator approval BEFORE first impl commit; **DEFER-with-issue-pin acceptable** if the investigation reveals the change should not ship - operator-confirmed deferral with a follow-up issue # documented
```

Also append to relevant patch-landed slots:

```
... pass: ... (or skipped-with-reason if {{ITEM}} deferred)
```

### pre-design-approval

Emit as the first non-investigation slot:

```
[N] DESIGN / COVERAGE MATRIX OPERATOR-APPROVED
  check: {{ARTIFACT}} posted to PR body; operator-comment confirms approval BEFORE {{CODE_VOLUME_THRESHOLD}}
  pass: operator-approved artifact locked in PR body
```

### drift-check (brief Gate mentions a drift check)

**Trigger:** brief `## Gates (binary)` includes "drift check against tier-matched archetype". Pair with:

```
[N] DRIFT CHECK RAN AGAINST TIER-MATCHED ARCHETYPE
  check: PR body or plan slot records the drift-check output (R-tier classification + findings + resolution); plan revisions captured
  pass: drift report attached; any tier-2/tier-3 findings either resolved or AskUserQuestion-confirmed as deliberate carve-outs
```

### conflicts-with (brief has a `## Conflicts-with check` section)

**Trigger:** brief includes the conflicts-with section. Pair with this slot near the pre-merge gates (before NO-ATTRIBUTION):

```
[N] CONFLICTS-WITH RE-VERIFIED PRE-MERGE
  check: PR body confirms every flagged row from the Conflicts-with table resolved cleanly (merged sibling PR reconciled OR no-overlap reconfirmed)
  cmd: git log --oneline {{BASE}} -- {{TOUCHED_PATHS}}
  pass: post-{{SIBLING_REF}} SHAs reconciled; no merge-conflict markers remain; affected files re-tested
```

`{{BASE}}` is `branch.base`.

---

## Slot operations

### Compound (one [N] slot, multiple cmd/pass pairs)

Use when two checks share semantic meaning and would be artificial to split:

```
[N] {{TITLE}}
  cmd: {{CMD_1}}
  pass: {{PASS_1}}
  cmd: {{CMD_2}}
  pass: {{PASS_2}}
```

Example: a migration probe AND a UI-chip grep under one slot - together they prove the schema change AND its UI surface landed coherently.

### Path-conditional

See the `path-fork` flag above. Pattern: `cmd: ({{LABEL}})` prefixed lines + per-label `pass:` lines.

### Anti-regression

Always pair with a positive patch-landed slot:

```
[N] NO REGRESSION ON {{BASELINE_BEHAVIOR}}
  cmd: {{BASELINE_VERIFICATION_CMD}}
  pass: {{BASELINE_PASS}} (verifies {{PR_REF}} didn't break the working path)
```

Required for ui-render (always), refactor (always), schema-additive (when touching the write-path), observability (always).

### Empirical-threshold (POST-FIX assertion that a previously-stuck metric can lift)

```
[N] {{METRIC}} EMPIRICALLY POSSIBLE
  check: post-fix {{ARTIFACT}} shows {{METRIC}} ({{OP}} {{VALUE}}) can now lift above {{BASELINE}}
  pass: documented evidence iter#{{ITER_NUM}}+ produces {{TARGET_VALUE}} post-merge
```

### Multi-environment-probe

```
[N] {{ARTIFACT}} APPLIED TO ALL ENVIRONMENTS
  cmd: for env in {{ENV_LIST}}; do {{ENV_CONNECT_CMD}} | xargs -I{} {{DB_CLIENT}} {} -c "{{PROBE}}" 2>&1; done
  pass: {{CONDITION}} on every environment
```

`{{ENV_LIST}}`, `{{ENV_CONNECT_CMD}}`, `{{DB_CLIENT}}` come from the project's facts/config. Required for migration class when the project has more than one DB environment; optional for schema-additive.

### Defer-acceptable (relax investigation pass-condition)

See the `defer-acceptable` flag above. Modifies the pass-line on investigation + patch-landed slots to accept "deferred-with-issue-pin" as a valid outcome.

---

## PRE-MERGE gate-graph

Default (single-gate):

```
PRE-MERGE:
  - operator AskUserQuestion -> yes ({{CONDITION_LIST}})
  {{#if COORD_FILE}}- coord row: {{ID_REGEX}} -> pre-merge{{/if}}
  - operator merges via {{MERGE_STRATEGY}}
```

`{{CONDITION_LIST}}` enumerates every gate-relevant decision. `{{MERGE_STRATEGY}}` is `merge.strategy` (default `rebase`). `merge.autonomous` MUST be false; the operator is the merge gate.

Split-gate (ui-render or observability class - visual sign-off as a parallel gate):

```
PRE-MERGE:
  - operator AskUserQuestion -> yes (contract satisfied; separate from the VISUAL SIGN-OFF gate at [N])
  - operator VISUAL SIGN-OFF -> yes ({{VISUAL_SIGN_OFF_REF}}; >={{N_SCREENSHOTS}} screenshots in PR comments)
  {{#if COORD_FILE}}- coord row: {{ID_REGEX}} -> pre-merge{{/if}}
  - operator merges via {{MERGE_STRATEGY}}
```

---

## POST-MERGE four sections

Required structure (mark sections N/A if not applicable, do NOT omit):

```
POST-MERGE:
  - **Bookkeeping**:
    {{#if COORD_FILE}}- coord row -> Closed rolldown{{/if}}
    {{#if PROGRESS_TRACKER}}- row {{INVENTORY_ROW_ID}} final-CLOSED with merge SHA{{/if}}
    - issue #{{ISSUE_N}} closed via "Closes #{{ISSUE_N}}" in the final commit
  - **Downstream unblocking**: {{DOWNSTREAM_PRS_OR_NA}}
  - **Operator triggers**: {{MANUAL_ACTIONS_OR_NA}}
  - **Retroactive verification**: {{POST_DEPLOY_SANITY_OR_NA}}
```

---

## Lint rules (applied in Phase 6)

1. **Investigation-to-[1]-slot consistency** - if the investigation directive is in GOAL, VERIFY[1] is `INVESTIGATION SURFACED BEFORE PATCH`. If not, fail.
2. **Class-to-slot coverage** - for each class tag, every slot listed under PR-Classes/{{class}} is present in VERIFY. Missing slots fail lint.
3. **Brief Gates-to-Contract VERIFY parity** - count of brief Gates ~ count of VERIFY items (off-by-one tolerated for "operator AskUserQuestion" being implicit in the brief).
4. **Operator decisions-to-AskUserQuestion list** - every `## You decide` bullet appears in `## When to AskUserQuestion`.
5. **Out-of-scope follow-up pins** - every brief `## Out-of-scope` bullet has `-> {{REF}}` to another PR ID, stage, or issue #. Bare deferrals fail lint.
6. **PRE-MERGE gate-graph** - class in {ui-render, observability} => PRE-MERGE has the split-gate pattern. Flag `cluster-issues` set OR class `test-debt` with >=30 commits => the AskUserQuestion condition-list mentions "post-categorization + per-category strategy approved" or equivalent.
7. **POST-MERGE 4-section coverage** - bookkeeping AND unblock AND triggers AND retro-verify present. Sections marked N/A pass lint; omitted sections fail.
8. **Branch range, not branch name** - the F3 slot's `git log` range anchors on `branch.base` (the merge-base), not a hardcoded branch literal. The branch name is non-load-bearing (the harness owns it), so do NOT require the substituted `branch.pattern` to appear identically in the brief and contract.
9. **Substrate via the tool** - the F2 packet slot calls `aiv.check_cmd` (no restated spec rule). F4 references only configured `review.*` paths; if neither `review.spec_sections.progress_tracker` nor `review.coord_file` is set, F4 is dropped with a note (not a hard fail).
10. **Floor slot order** - TYPECHECK -> PACKET-VALIDATES -> NO-ATTRIBUTION/NO-BYPASS (track-aware title per `launch_brief.track`) -> PROGRESS-TRACKER (if present) -> REVIEW-QUIET-WINDOW -> ISSUE-CLOSED appear in that order at the END of VERIFY.
11. **Slot numbering monotone** - `[1]`, `[2]`, ... contiguous. No gaps.
12. **Banner glyph integrity** - exactly 5x `=` (box-drawing double-horizontal) each side of the banner title, opening and closing.
13. **Brief Gate-to-Contract slot pairing** - every brief Gate of the form "X against Y" or "X ran" has a contract VERIFY slot ENFORCING X ran (not merely citing Y). A Gate that references an artifact without a slot that enforces the artifact exists fails lint.
14. **Anti-regression slot for ui-render** - if class includes `ui-render` AND the PR touches an existing user-facing route, the contract MUST have at least one anti-regression slot. Pure new-route PRs are exempt.
15. **Visual sign-off for ui-render** - if class includes `ui-render`, the contract MUST have either an OPERATOR VISUAL SIGN-OFF slot with a `gh pr view --json comments | grep -iE "VISUAL SIGN-OFF|approved"` recipe OR a compound DRILL+VISUAL-SIGN-OFF slot. A bare drill without an operator-confirmation recipe fails lint.

Lint failures are surfaced as text to the operator BEFORE Phase 7 file writes. The operator decides whether to fix the inputs or override the lint (rare - usually a missing class tag or a flag the operator forgot to set).

---

## Class binding sanity check (Phase 2)

During Phase 2 (Classify), validate the class binding produced a slot count + structural feature consistent with the class:

| Class | Expected floor + class slots | Notable structural feature |
|---|---|---|
| migration | floor + 4-5 | pre-patch gap probe; up/down pair; multi-environment-probe |
| ui-render | floor + 4-5 | anti-regression slot (mandatory); visual sign-off; split PRE-MERGE |
| dispatcher | floor + 4-5 | correlation-id propagation probe; phase/state column |
| refactor | floor + 3 | behavior-pinning tests precede refactor commit |
| schema-additive | floor + 3-4 | writer-sets-field probe; multi-environment DDL |
| infrastructure | floor + 3 | CI-green + no-regression-on-other-workflows |
| test-debt | floor + 4-5 | root-cause categorization (not by-file); brittle-pin policy |
| observability | floor + 4 | heartbeat/emit slot; live-fire stream-stays-open; split PRE-MERGE |
| docs | floor + 2-3 | source-of-truth boundary; links resolve |
| e2e-harness | floor + 4 | cost model; failure-notification demonstrated; trigger wired; secret-never-committed |

A binding that produces a slot count well outside the expected band is a signal to recheck the class tag or the flags.
