# The 5 angles + diff-signal probes

Fire all 5 Explore sub-agents in ONE message. Each prompt is self-contained.

Slot syntax: `{{PR_NUMBER}}` `{{BRANCH}}` `{{CONTRACT}}` `{{FILES}}` `{{MEMORY_LIST}}`
`{{SPEC_SECTIONS}}` `{{DIFF_SIGNAL_PROBES_A1}}`...`{{DIFF_SIGNAL_PROBES_A5}}`.

`{{SPEC_SECTIONS}}` expands to the configured `review.spec_sections` map - the project's
progress-tracker section (`review.spec_sections.progress_tracker`) and iteration / quality-matrix
section (`review.spec_sections.iteration`), both inside the project spec/design doc (`aiv.spec_path`).
If a section key is blank, tell the sub-agent that check is "not configured - skip it."

Every sub-agent prompt MUST begin with the read-only guardrail:

> READ-ONLY RESEARCH. Do NOT run the project test suite (`vitest` / `playwright` / `npm test` or the configured `ci.*` commands). Do NOT modify / commit / push / approve. Return numbered claims with `file:line` evidence. Trust nothing without `git show {{BRANCH}}:<path>` or `gh` verification.

---

## Angle 1 - Spec / design-doc alignment

> {{guardrail}}
>
> Read the project spec/design doc (`aiv.spec_path`) at the sections named in {{SPEC_SECTIONS}}: the progress-tracker section (the rows this PR claims to close), the iteration / quality-matrix section, and any closest wave-closure narrative. Read PR #{{PR_NUMBER}} body via `gh pr view {{PR_NUMBER}} --json title,body`. If a plan slot exists in the configured plans dir matching the PR, read it.
>
> Answer:
> (a) Does the delivered scope materially advance the spec's headline goal (the baseline the project is trying to beat on findings / narrative / verifiability) and, if relevant, the quality matrix?
> (b) Which progress-tracker IDs does the PR claim to close? Are they actually closed (design-doc rows annotated, scope matches)?
> (c) Is the PR body's investigation/goals section honest - does it explain WHY the change is needed, not just WHAT changed?
> (d) Any scope drift from the originating plan slot or coordination-file row (`review.coord_file`)?
>
> {{DIFF_SIGNAL_PROBES_A1}}
>
> Return 6-8 numbered claims, each <=1 sentence, with `file:line` evidence.

## Angle 2 - Code / diff / cascading effects

> {{guardrail}}
>
> Read PR #{{PR_NUMBER}} diff via `gh pr diff {{PR_NUMBER}}`. For each modified functional file in {{FILES}}, read at HEAD via `git show {{BRANCH}}:<path>` (focus on the changed lines + their immediate context).
>
> Answer:
> (a) Does the impl actually do what the PR body claims (no patch-around, no scope creep)?
> (b) Cascading effects - does the change touch downstream callers? Any caller whose contract assumption is now broken?
> (c) Backward-compat - are new function params optional? Any breaking signature change without a migration note?
>
> {{DIFF_SIGNAL_PROBES_A2}}
>
> Return 6-8 numbered claims with `file:line` evidence.

## Angle 3 - Test / TDD / assertion-to-code alignment

> {{guardrail}}
>
> Read PR #{{PR_NUMBER}} commits in order via `gh pr view {{PR_NUMBER}} --json commits --jq '.commits[] | {sha:.oid, msg:.messageHeadline, date:.committedDate}'`. For each spec/test file added or modified in {{FILES}}, read at HEAD via `git show {{BRANCH}}:<path>`.
>
> Answer:
> (a) TDD ordering - did spec commits land before impl commits for each item, OR same-commit spec+impl (NOT TDD)?
> (b) For each contract item that claims spec coverage, does a spec assertion actually exist that mechanically verifies the claim?
> (c) Assertion-to-code alignment - do the asserted symbols/strings actually exist in the impl at the asserted location?
> (d) Any `.skip` / `.todo` / pinning-only specs without coverage?
>
> {{DIFF_SIGNAL_PROBES_A3}}
>
> Return a per-contract-item verdict (PASS/WARN/FAIL with `file:line`).

## Angle 4 - Bug-catalog completeness + design-tests discipline

> {{guardrail}}
>
> Read the sibling `design-tests` skill (`skills/design-tests/SKILL.md`) for the catalog-first methodology.
>
> Enumerate every functional file ADDED or MODIFIED in PR #{{PR_NUMBER}} (exclude test/spec files, `.md`, and anything under the packets dir `aiv.packets_dir`).
>
> For EACH such file:
> - Does a paired `<file>.bug-catalog.md` exist at HEAD? Check via `git show {{BRANCH}}:<file>.bug-catalog.md` (a non-zero exit = missing).
> - If MISSING and the file is NEW -> catalog REQUIRED (every new functional file needs a bug catalog; this is the design-tests-scope principle).
> - If a catalog exists: list its catalog IDs; grep specs for `(catalog-id)` patterns; flag any catalog ID not pinned in any spec test name.
>
> {{DIFF_SIGNAL_PROBES_A4}}
>
> Return a table: (path, catalog-exists Y/N, catalog-IDs-listed, catalog-IDs-pinned-in-specs, IDs-unpinned).

## Angle 5 - Discipline / commit hygiene / verification packets / memory honor

> {{guardrail}}
>
> Enumerate PR #{{PR_NUMBER}} commits via `gh pr view {{PR_NUMBER}} --json commits`.
>
> For each commit:
> - Count changed files. If the project enforces an atomic-commit policy via its commit hook (e.g. 1 functional file + 1 verification packet), check that each commit conforms OR that a cluster pattern is explicitly documented in the PR body.
> - For each verification packet path under the packets dir (`aiv.packets_dir`, default `.github/aiv-packets`): validate it through the `aiv` CLI rather than by eye -> `<aiv.check_cmd> <packet-path>` (default `aiv check`). Report the CLI's pass/fail and any findings it prints. Do NOT restate packet-header rules as your own knowledge.
> - Commit-message hygiene: no `--no-verify`, no `--amend`, no agent attribution (`Co-Authored-By:` an agent).
>
> Then audit:
> - Coordination file (`review.coord_file`, if configured) - is this PR's row present and its checkpoint transitions reflected? If `review.coord_file` is blank, note "no coordination file configured - skipped."
> - Progress-tracker closure annotation (in `aiv.spec_path` at `review.spec_sections.progress_tracker`) in the final commit, if the PR claims to close tracker items.
> - CR-quiet-window - `gh pr view {{PR_NUMBER}} --json reviews --jq '.reviews[-1] | {submittedAt, body: .body[:200]}'`. **Read the CR body, not just the status** - a "success" status is not "no findings." If a CR review fired recently, flag the window.
>
> Memory entries to honor for this PR (universal principles always; project-specific lessons only if the host project's memory carries them):
> {{MEMORY_LIST}}
>
> For each cited entry: does the PR work honor the rule? Flag violations.
>
> Return a per-memory verdict + a per-commit-rule verdict.

---

# Diff-signal mapping (substitute into {{DIFF_SIGNAL_PROBES_*}})

Inspect {{FILES}} and inject the matching probes. The signals below are described by **file-shape
pattern** so they generalize across projects; treat the example globs as illustrative, not absolute.
Project-specific path globs and the project-specific lessons cited come from the host project's own
memory (`memory.dir`) - see `memory-honor.md`. Multiple signals can match; concatenate all matching
blocks. The probes restate methodology (what to check), not project-private incident detail.

## Signal: auth / middleware / route-guard

**Matches:** the project's request-middleware / route-authorization surface.

**A1 probes:** Does the change align with the documented route/role planning in `aiv.spec_path`?
**A2 probes:** Are new route matchers narrow (no over-broad regex matching unintended paths)? Are role / permission strings canonical against the project's role type (not a typo'd literal)? Grep the changed surface for stale/typo'd role literals and flag hits.
**A3 probes:** Are both the positive case (allowed -> 2xx) and the negative case (denied -> 403) pinned in the middleware spec? Is a spec-alignment row added per new matcher?

## Signal: data-access layer (DAL) / store

**Matches:** the project's data-access interface + implementation + per-entity reader/writer commands.

**A1 probes:** Does the DAL change advance the spec's forensic-defensibility goal (every signal traceable via a correlation id)?
**A2 probes:** Are new params (correlation id, session id) OPTIONAL for backward-compat? Does any insert-or-ignore-returning pattern handle the TOCTOU race correctly? Do row-to-object converters strip row-metadata keys before merge (or keep content fields nested) so a downstream `...prior` merge can't clobber fresh values with stale metadata?
**A3 probes:** Do new integration specs run against a real database (a throwaway container), NOT an in-memory surrogate that silently accepts dialect bugs? Do concurrency proofs actually fire concurrent calls (`Promise.all`), not sequential ones?

## Signal: subprocess / long-running dispatcher / daemon

**Matches:** the project's background-worker / dispatcher / watch commands.

**A1 probes:** Does the relevant prompt/spec for the dispatcher align with the change?
**A2 probes:** Are timeout / API-cost / context-window concerns addressed? Any spec pinning OLD behavior the change breaks?
**A3 probes:** Does the PR body document a **wall-clock end-to-end drill** (subprocess spawn -> completion with timestamps)? Unit tests alone are insufficient for a daemon - a subprocess/external-system change needs a real composed run. Do long-running dispatchers emit step events at await boundaries so a stall is distinguishable from progress?

## Signal: database migration

**Matches:** the project's migration files.

**A1 probes:** Is the migration slot number contiguous (no gap, no collision with a parallel PR)?
**A2 probes:** Is there a DOWN / rollback path? If RLS-related, does the migration probe + rotate the DB role to ensure the connecting role does NOT bypass row-level security (a migration + green canary can still leave prod bypassed if the role bypasses RLS)?
**A5 probes:** Does the PR body confirm the migration ran successfully against a real (throwaway) database branch? (Check state before asserting it applied.)

## Signal: UI / rendered view / templated component

**Matches:** the project's page / component / template surface.

**A1 probes:** Are spec/test files placed OUTSIDE the framework's auto-routed pages directory (so they don't become routes)?
**A2 probes:** Does any new component import a server-only module that would break the SSR boundary?
**A3 probes:** If browser tests touch a polling/timing component, do they install a controllable clock and keep the tab foregrounded (background-tab timer throttling silently extends poller latency and flakes the test)?

## Signal: scheduled function / serverless cron / API route

**Matches:** the project's cron / scheduled-function / API-route surface.

**A2 probes:** Do handlers that lack an ambient request session wrap their data-access calls in the project's synthetic-session helper (a serverless cron has no request-scoped session and the DAL will reject the call otherwise)?

## Signal: CLI verb / script / executable

**Matches:** the project's CLI entrypoint, command modules, scripts, and any installed binary.

**A2 probes:** Does the PR body document an end-to-end smoke test with the exact invocation form (catches arg-parser / flag-collision bugs that unit tests miss)? If an installed binary / symlink was touched, was its target verified to point at the right working tree?

## Signal: CI workflow

**Matches:** the project's CI workflow definitions.

**A2 probes:** Is the configured runner used correctly? If a startup failure was observed, was the repo-wide / org / billing state checked before debugging the YAML? Was a local-CI replica run before the push?

## Signal: verification packets

**Matches:** files under the packets dir (`aiv.packets_dir`).

**A5 probes:** Validate each packet via `<aiv.check_cmd>` and report what the CLI says - do NOT hand-check header strings. If the project uses a per-packet progress header, is it synced with the commit list? Are evidence classes present above the mandatory tier floor where they aid the reviewer / rollback?

## Signal: coverage config / large spec batch

**Matches:** the project's coverage config + spec files.

**A3 probes:** Did the PR add real tests until aggregate coverage went up (rather than defaulting to a coverage-exempt-paths escape hatch)? A small PR that hits the aggregate ratchet should write tests, not exempt itself.

---

# Default probe (if no signals match)

**All angles:** apply only the core questions; skip the diff-signal block. This usually indicates a
docs-only or coordination-file-only PR, where the discipline angle (Angle 5) carries most of the
weight.
