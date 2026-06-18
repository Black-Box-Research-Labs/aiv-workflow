# Contract derivation engine

Produces a near-strict-quality completion contract from PR / issue / diff / coordination-doc / plan
signals, without requiring a hand-written `*-completion-contract.md`. Invoked from `SKILL.md` Stage 3
when no per-PR contract file is found (or the found file carries the `-DERIVED` suffix).

All project facts come from `.aiv-workflow.yml` (see `SKILL.md`'s config block). Where this file
shows a config key in `<angle-brackets>`, substitute the configured value (or its default).

Output structure:

```
═════ COMPLETION CONTRACT - <derived-title> (DERIVED) ═════

GOAL: <derived from PR body + issue body>

VERIFY (binary green/red):

[1]      <Stratum D - operator directive, if any>
[2..N]   <Stratum B - PR-body promises>
[N+1..M] <Stratum C - diff-signal probes>
[M+1..]  <Stratum A - universal scaffold>
[...]    <Stratum-A-extensions - memory-driven discipline items>

PRE-MERGE:
  - operator AskUserQuestion → yes
  - coordination row: <PR-slug> → pre-merge   (only if review.coord_file configured)
  - gh pr merge --<merge.strategy> --delete-branch

POST-MERGE:
  - coordination row → Closed rolldown          (only if review.coord_file configured)
  - <progress-tracker IDs> final-CLOSED with merge SHA  (only if review.spec_sections.progress_tracker configured)
  - <issue closure if Closes #N>
  - <cross-PR sequencing notes>

DERIVATION NOTES:
  - Confidence breakdown: N high / M medium / K low
  - Source signals consumed: <list>
  - Items where operator-tuning recommended: <list of indices>
```

## Inputs (gather first)

```bash
# 1. PR metadata
PR_JSON=$(gh pr view <N> --json title,body,commits,files,closingIssuesReferences,labels,headRefName,headRefOid)

# 2. Linked issue bodies (one per closing reference)
for ISSUE in $(echo "$PR_JSON" | jq -r '.closingIssuesReferences[].number'); do
  gh issue view "$ISSUE" --json title,body,labels
done

# 3. Diff file list + diff content
FILES=$(echo "$PR_JSON" | jq -r '.files[].path')
gh pr diff <N>

# 4. Wave / cross-PR coordination doc, if the project keeps one (review.coord_file or a
#    coordination doc under the contracts dir)
[ -n "<review.coord_file>" ] && cat "<review.coord_file>"
find "<review.contracts_dir, default .aiv/launch-briefs>" -name '*coordination*.md' 2>/dev/null

# 5. Plan slot (if present in the configured plans dir)
ls <plans.dir>/pr-*.md 2>/dev/null | grep -iE "<title-slug>"

# 6. Progress-tracker IDs the PR claims to close (grep PR body for the project's tracker-ID shape)
echo "$PR_JSON" | jq -r '.body' | grep -oE '<project tracker-ID regex, e.g. closure IDs the spec uses>'
```

## Stratum A - Universal scaffold (always emit)

These items are project-agnostic in structure; only the bindings (packet prefix, packets dir, merge
strategy, tracker section, coord file) come from config. Items keyed to a blank config value are
emitted as `N/A (not configured)`.

```
[X] TYPECHECK + LOCAL-CI (impl agent's claim - reviewer does NOT run it)
  check: PR body or CI logs assert typecheck + local-CI green for the derived spec list.
  pass: asserted (read-only). The reviewer verifies the ASSERTION exists, never runs the suite.

[X+1] ATOMIC-COMMIT POLICY / VERIFICATION PACKETS
  cmd: gh pr view <N> --json commits --jq '.commits | length'
       ; ls <aiv.packets_dir>/VERIFICATION_PACKET_*.md | wc -l
       ; for p in <packets>; do <aiv.check_cmd> "$p"; done
  pass: per-commit file count conforms to the project's commit-hook policy (or a cluster pattern is
        documented in the PR body); every packet passes `<aiv.check_cmd>`. Let the aiv CLI judge
        packet shape - do NOT restate header rules here.

[X+2] NO ATTRIBUTION / NO BYPASS
  cmd: git log <BRANCH> --pretty=format:'%B' | grep -cE 'Co-Authored-By:|--no-verify|--amend'
  pass: 0 matches

[X+3] PROGRESS-TRACKER + COORDINATION FILE
  check: if review.spec_sections.progress_tracker configured, grep that section of aiv.spec_path for
         a "CLOSED in <PR>" annotation; if review.coord_file configured, grep it for this PR's row.
  pass: tracker rows annotated; coordination row present with its checkpoint transitions.
        (N/A if either key is blank.)

[X+4] CR-QUIET-WINDOW
  cmd: gh pr view <N> --json reviews --jq '.reviews[-1] | (.body[:120] + " | submittedAt=" + .submittedAt)'
  pass: latest CR review body shows no actionable comments AND was submitted more than `review.cr_quiet_window` (default 6h) ago;
        read the BODY, not just the status.
```

PRE-MERGE + POST-MERGE blocks are also universal - emit verbatim (with coord / tracker lines gated on
their config keys).

## Stratum B - PR-body promises (parse the body)

Read `gh pr view --json body --jq '.body'` and the bodies of all `closingIssuesReferences`. Apply
these parsers in order; each produces 0 or more contract items.

### B1 - Goal parser (verb-driven)

Find lines matching the patterns below; emit a contract item per match. The verb determines the
probe shape.

| Verb / phrase in PR or issue body | Item template |
|---|---|
| `Close[s] #N` / `Fix[es] #N` | Stratum A tracker block + POST-MERGE line `issue #N closed via "Closes #N"` |
| `add[s] <symbol>` / `extend[s] <file> with <symbol>` / `implement[s] <symbol>` | `cmd: grep -nE '<symbol>' <file>` / `pass: >=1 match` (HIGH) |
| `migrate <table>` / `migration ... <table>` / `column <col>` | `cmd: <project db-introspect cmd> '\d <table>'` / `pass: includes <col>` (HIGH) |
| `fix[es] <file>:<line>` / `bug at <file>:<line>` | `cmd: git diff <branch.base>..HEAD <file> \| grep -E '<line context>'` / `pass: >=1 changed line at vicinity` (MEDIUM) |
| `replace[s] <old> with <new>` / `rename <old> to <new>` | `cmd: grep -nE '<new>' <files>; grep -cE '<old>' <files>` / `pass: >=1 new; 0 old` (HIGH) |
| `ship[s] X + Y + Z` (multi-clause goals) | Emit one item per clause; use the clause's symbol as the probe target |
| `Path A vs Path B` / `decision: Path A` | Stratum D `PATH DECISION SURFACED + APPROVED` item (see D-section) |
| `investigate before patch` / `1-line fix is suspicious` | Stratum D `INVESTIGATION SURFACED BEFORE PATCH` item |
| `iter#N` / `live-fire` / `real-target smoke` / a named DB branch | See B2 |

### B2 - Iter / live-fire claim parser

If the PR body contains "iter#N", "live-fire", "real-target", or a named DB branch, emit:

```
[X] ITER#<N> LIVE-FIRE EVIDENCE
  check: PR body documents the iter#<N> run with concrete artifact references (run id, artifact path,
         branch name)
  pass: all referenced artifacts exist; <if "branch torn down" claimed> branch confirmed deleted
```

Threshold extraction: scan for `>=(\d+)` / `at least (\d+)` and embed the number in the probe's
pass-criterion.

### B3 - Spec coverage claim parser

For every spec/test file in `gh pr diff --name-only | grep '<project spec-file pattern>'`, emit:

```
[X] SPEC COVERAGE - <area>
  check: spec exists at HEAD; assertions pin <derived from spec content via grep `expect(` or the
         project's assertion form>
  pass: spec present; >=1 real assertion per scenario. (Reviewer verifies EXISTENCE - does NOT run it.)
```

Confidence: HIGH (mechanical).

### B4 - Bug-catalog parser

For every `*.bug-catalog.md` in the diff, emit:

```
[X] BUG-CATALOG COMPLETENESS - <file>
  cmd: git show <BRANCH>:<file>.bug-catalog.md | grep -cE '^##|^- '
  pass: catalog exists; IDs grep-able in the paired spec via the `(catalog-id)` pattern
```

For every NEW functional file in the diff that does NOT have a paired catalog, emit a FAIL item (every
new functional file needs a bug catalog - the design-tests-scope principle):

```
[X] BUG-CATALOG REQUIRED - <new-file>
  check: git show <BRANCH>:<new-file>.bug-catalog.md
  pass: file exists (exit 0); IDs pinned in specs
```

## Stratum C - Diff-signal probes (table-driven)

Apply this table against `<FILES>`. Signals are described by file-shape so they generalize; the
example globs are illustrative. Multiple signals can match; concatenate items.

| Diff signal (file-shape) | Derived contract item |
|---|---|
| migration files | `[X] MIGRATION CONTIGUOUS + DOWN - cmd: ls <migrations-dir>/ \| sort \| tail -5 ; grep -E 'BEGIN;\|DROP' <migration> / pass: contiguous slot; DOWN/rollback present` |
| migration + PR body names a DB branch | `[X] MIGRATION APPLIED - for each named branch, introspect the target table / pass: table exists on all named branches` |
| DAL interface + impl both touched | `[X] DAL INTERFACE↔IMPL PAIRED - cmd: grep -nE '<derived-symbol-from-diff>' <dal-interface> <dal-impl> / pass: >=2 matches` |
| auth / route-middleware touched | `[X] ROLE-STRING DRIFT-FREE - cmd: grep -rE '<typo'd/stale role literal>' <source> / pass: 0 stray hits OR a documented audit in the PR body` |
| long-running dispatcher touched | `[X] DISPATCHER SPEC PINNED - check: spec asserts <symbol> at HEAD` PLUS `[X+1] SUBPROCESS SMOKE - check: PR body documents a wall-clock end-to-end drill (spawn → completion with timestamps)` |
| synthesis/rule-consumer touched | `[X] RULE CONSUMER LANDED - cmd: grep -cE '<rule marker>' <consumer-file> / pass: >=<derived-N> matches` |
| UI component touched | `[X] UI RENDER - check: PR body has a DOM-extract OR an operator screenshot showing <symbol> render / pass: visual evidence present` |
| serverless cron / sessionless API route | `[X] CRON SESSION WRAP - cmd: grep -nE '<synthetic-session helper>' <cron-file> / pass: >=1 match` |
| CLI entrypoint / new verb | `[X] CLI SMOKE - check: PR body documents `<cli> <verb> --help` + a non-error invocation / pass: documented` |
| CI workflow file | `[X] WORKFLOW VALIDATED - cmd: gh workflow view <name> ; gh run list --workflow=<name> -L 3 / pass: registered; recent runs green or N/A if new` |
| browser/e2e spec | `[X] E2E SPEC EXISTS - cmd: <DO NOT RUN - verify spec EXISTS + assertions reference real selectors> / pass: spec at HEAD; >1 assertion per scenario` |
| serverless platform config | `[X] PLATFORM CONFIG VALID - check: config syntactically valid; no runtime regressions noted in PR body` |

## Stratum D - Operator / cohort directives

Parse the coordination doc (`review.coord_file`, or a coordination doc under `review.contracts_dir`)
AND the PR body for directive phrases. Emit a Stratum D item per directive.

### D1 - Investigation directive

Triggers: the coordination doc flags the PR's row with "investigation directive" / "1-line fix is
suspicious" / "investigate before patch", OR the PR body has an `INVESTIGATE BEFORE PATCH` header.

```
[1] INVESTIGATION SURFACED BEFORE PATCH
  check: PR body has an investigation section (git blame + hypothesis ranking + cascading-effects
         analysis); an AskUserQuestion thread if the hypothesis is non-trivial
  pass: present; operator approval BEFORE the first impl commit
```

### D2 - Path-decision directive

Triggers: the coordination doc mentions "Path A vs Path B" / "operator decides at plan-mode", OR the
PR body has `Path A` and `Path B` sections.

```
[1] PATH DECISION SURFACED + APPROVED
  check: PR body has a "Path A vs Path B" section with rationale + an AskUserQuestion thread + operator
         approval BEFORE the first impl commit
  pass: present; thread documented; operator-approved path locked in the PR body
```

### D3 - Iter-budget directive

Triggers: the coordination doc's PR row shows an iter budget > 0.

```
[X] ITER BUDGET HONORED
  check: PR body shows iter#N runs (N = the allocation); each iter documented with an artifact path
  pass: actual iter count <= budget; each iter shows substantive progress (not no-ops)
```

### D4 - Cross-PR coordination directive

Triggers: the coordination doc's overlap / sequencing section mentions this PR.

Action: emit as a POST-MERGE bullet (NOT a VERIFY item - sequencing is process, not a binary gate):

```
POST-MERGE:
  - <derived sequencing note>
```

### D5 - Risk-tier directive

Triggers: the coordination doc tags the PR with a risk tier (e.g. R2 / R3).

```
[X] RISK TIER <R> EVIDENCE
  check: PR body has expanded eval evidence per the spec's tier-<R> requirements (e.g. additional
         operator-confirmation evidence; a rollback procedure for higher tiers). Validate the packet
         via `<aiv.check_cmd>` - let the CLI judge the tier floor.
  pass: tier-<R> floor met per the aiv CLI; packet evidence classes are tier-appropriate.
```

## Stratum-A-extensions (memory-driven)

Apply the `memory-honor.md` signal -> entry table to the diff file list. For each matched memory
entry from the **host project's own memory** (`memory.dir`), emit a discipline item. These travel
only if the host project's memory carries the lesson; if no memory dir is present, emit only the
universal-principle items below.

Universal-principle discipline items (always available, no memory dir needed):

| Principle | Item template |
|---|---|
| real-DB integration tests | `[X] REAL-DB INTEGRATION - check: new integration specs run against a throwaway DB container, NOT an in-memory surrogate / pass: confirmed (grep / PR body)` |
| subprocess wall-clock drill | `[X] SUBPROCESS WALL-CLOCK DRILL - check: PR body documents an end-to-end subprocess drill (spawn → completion with timestamps) / pass: documented` |
| CLI end-to-end smoke | `[X] CLI SMOKE - check: PR body documents an end-to-end smoke test with the exact invocation form / pass: documented` |
| browser polling-test clock | `[X] CONTROLLED CLOCK - cmd: grep -nE '<clock-install helper>' <browser-specs> / pass: >=1 match for polling-test specs` |
| migration role-bypass probe (RLS) | `[X] ROLE BYPASS PROBE - check: PR body documents probe + rotate so the connecting role does NOT bypass RLS after cutover / pass: documented` |
| large-PR merge strategy | `[X] MERGE STRATEGY - check: if commits exceed the host's rebase-merge limit, PR body acknowledges the merge-commit fallback (NOT squash) / pass: documented` |

Project-specific item templates (only if the host project's memory carries the matching lesson - see
`memory-honor.md`). Skip any entry whose signal block produces 0 diff matches.

## Confidence labeling

Each emitted item gets a confidence suffix in the DERIVATION NOTES section:

- **HIGH** - mechanically derivable (grep against a named file/symbol from the PR body or diff).
- **MEDIUM** - heuristic (a threshold extracted from prose; a verb inferred from context).
- **LOW** - operator-tuning recommended (a subjective claim with no numeric threshold).

The review uses confidence to set probe behavior:
- HIGH item failed -> load-bearing FAIL
- MEDIUM item failed -> WARN
- LOW item failed -> flag `?` UNVERIFIABLE in synthesis, with "operator-tuning recommended"

## Output handling

After deriving, write to `<review.contracts_dir, default .aiv/launch-briefs>/<derived-pr-slug>-completion-contract-DERIVED.md`.
The `-DERIVED` suffix flags it as machine-generated. The skill continues to Stage 4 using this file
as its STRICT-mode contract. If the operator later edits the file (removing the `-DERIVED` suffix),
the next `/or-review` run picks it up as a true STRICT contract.

## Failure modes

If derivation finds <5 emitted items beyond the Stratum A scaffold (empty PR body, no closing issue,
docs-only diff with no signal matches), fall back to `contract-scaffold.md`'s minimum core + Pattern
A-E. Mark the mode in synthesis as `SCAFFOLD (minimum)` rather than `SCAFFOLD (derived)`.

## Worked example (illustrative)

A PR whose body reads: "Close #N - ship E1 (a status enum + a UI chip) + E2 (a new table + DAL
accessor) + E3 (a new column). 3 migrations," with a diff touching migration files, the DAL
interface + impl, a UI component, a dispatcher writer, and specs:

- **Stratum B** (goal parser): "Close #N" -> tracker closure + POST-MERGE issue closure; each of
  E1/E2/E3 -> a grep/introspect probe against its named symbol; "3 migrations" -> a migration-count
  check.
- **Stratum C** (diff probes): migration files -> contiguous + DOWN + applied-to-named-branches; DAL
  pair -> interface<->impl grep; UI component -> render evidence; dispatcher -> spec pinned.
- **Stratum A** (scaffold): typecheck-asserted / atomic-commit + packets / no-attribution /
  tracker+coord / CR-window.
- **Stratum-A-extensions**: DAL+spec touched -> real-DB integration item + row-metadata-strip item
  (the latter only if the host memory carries that lesson).
- **Stratum D**: if the coordination doc flags an investigation directive or a path decision, emit
  D1/D2; sequencing overlap -> POST-MERGE note.

Result: ~14 contract items, close to what a hand-written contract for the same PR would carry. The
items a derivation can miss are the ones requiring out-of-band knowledge (e.g. WHICH DB branches
matter) - extractable from the coordination doc if it lists them, otherwise flagged for
operator-tuning.
