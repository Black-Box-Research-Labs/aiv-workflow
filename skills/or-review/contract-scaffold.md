# Contract scaffold (SCAFFOLD MODE fallback)

Used when no per-PR `*-completion-contract.md` exists under the contracts dir (`review.contracts_dir`,
default `.aiv/launch-briefs`) AND derivation produced too little signal. Verification is softer - items are marked
`?` instead of failed when not mechanically checkable from PR metadata + diff alone.

The posted comment in SCAFFOLD MODE MUST begin with this warning line:

> ⚠ **Scaffold mode** - no per-PR contract file found under the contracts dir, and the derivation engine produced insufficient signal. Verification is softer than strict mode; recommend writing a `*-completion-contract.md` for the next round.

All project facts come from `.aiv-workflow.yml`; substitute the configured value (or default) for any
`<angle-bracket>` key.

## Core items (always present)

```
[1]  PR BODY HONESTY
  pass: PR body has an explicit "Goals" / "Scope" / "Changes" section explaining WHY the change is
        needed (not just WHAT changed); body matches the diff (no scope claims absent from code).

[2]  DIFF SCOPE INTEGRITY
  pass: every file in the diff is mentioned in the PR body OR is mechanically necessary
        (spec / packet / coord file / docs / migration); no silent out-of-scope changes.

[3]  BUG-CATALOG COMPLETENESS
  cmd: for each NEW functional file F: git show <branch>:F.bug-catalog.md
  pass: every NEW functional file has a paired `.bug-catalog.md` at HEAD; catalog IDs pinned in at
        least one spec. (Every new functional file needs a catalog - the design-tests-scope principle.)

[4]  SPEC COVERAGE
  pass: every MODIFIED functional file has paired spec coverage updated in the same PR; new
        assertions reference symbols that exist in the impl at the asserted line. (Reviewer verifies
        EXISTENCE; does NOT run the suite.)

[5]  ATOMIC-COMMIT POLICY
  cmd: gh pr view <N> --json commits --jq '.commits[] | {sha:.oid, msg:.messageHeadline}'
  pass: each commit conforms to the project's commit-hook policy (e.g. 1 functional file + 1
        verification packet) OR a cluster pattern is explicitly documented in the PR body.

[6]  VERIFICATION PACKETS VALID
  cmd: for each packet under <aiv.packets_dir> in the diff: <aiv.check_cmd> <packet>
  pass: every packet passes the aiv CLI validator. Let the CLI judge shape - do NOT restate header
        rules here.

[7]  NO ATTRIBUTION / NO BYPASS
  cmd: git log <branch> --pretty=format:'%B' | grep -cE 'Co-Authored-By:|--no-verify|--amend'
  pass: 0 matches.

[8]  COORDINATION FILE
  cmd: grep -i "<pr-tag>" <review.coord_file>
  pass: row present with its checkpoint transitions recorded. (N/A if review.coord_file is blank.)

[9]  PROGRESS-TRACKER CLOSURE
  cmd: grep "CLOSED in <pr-tag>" <aiv.spec_path>   (at review.spec_sections.progress_tracker)
  pass: every tracker ID the PR claims to close is annotated with the merge SHA in the final commit
        (or N/A if the PR claims no tracker closures, or review.spec_sections.progress_tracker is blank).

[10] CR-QUIET-WINDOW
  cmd: gh pr view <N> --json reviews --jq '.reviews[-1] | (.body[:120] + " | submittedAt=" + .submittedAt)'
  pass: the latest CR review body shows no actionable comments AND was submitted before the quiet
        window, OR no CR review has fired yet. **Read the body, not just the status** - a "success"
        status is not "no findings."
```

## PR-specific items (derived from PR-body parsing)

After the core items, parse the PR body for additional contract items.

### Pattern A - "Goals: [N] X, Y, Z"

If the PR body has an explicit goals list, derive one contract item per goal:

```
[N+1] GOAL <X> LANDED
  pass: <interpret the goal text> - file/symbol/behavior asserted in the diff at file:line
  spec coverage: a paired spec assertion exists
```

### Pattern B - Issue references

If the PR body links GitHub issues (`Closes #N`, `Fixes #N`):

```
[N+1] ISSUE #<N> CLOSED
  cmd: gh pr view <PR#> --json closingIssuesReferences
  pass: an autoclosing link to the issue is present; the issue's acceptance criteria are addressed by
        the diff
```

### Pattern C - Iter cycles claimed

If the PR body mentions "iter#N" / "live-fire cycle" / "real-target smoke":

```
[N+1] LIVE-FIRE EVIDENCE
  pass: PR body documents the iter or smoke run with concrete evidence (artifact path, run id, branch
        name); the branch is torn down if a throwaway DB branch was used
```

### Pattern D - Migration claimed

If the diff includes migration files:

```
[N+1] MIGRATION SLOT CONTIGUOUS
  cmd: ls <migrations-dir>/ | sort | tail -5
  pass: the new migration number is contiguous; a DOWN/rollback is provided; the PR body documents
        the migration applied successfully against a throwaway DB branch
```

### Pattern E - TypeCheck claim

If the PR body says "tsc clean" / "typecheck green":

```
[N+1] TYPECHECK CLEAN
  pass: PR body explicitly asserts typecheck clean OR CI logs show the typecheck job green (read-only:
        do NOT run the typechecker ourselves)
```

## SCAFFOLD MODE verdict policy

- Core items 5/6/7/8/9 are **mechanically checkable** from PR metadata -> mark verified or failed.
- Core items 1/2/3/4 require **inference from diff + body** -> mark verified if confident, `?` if soft.
- Core item 10 requires `gh` JSON -> mark verified/failed.
- Derived items (Pattern A-E) are **softer** -> bias toward `?` unless mechanically verifiable.

If the overall ratio of `?` to total is > 40%, append to the recommendation:

> Strict mode would catch more - write a `<review.contracts_dir>/<pr-slug>-completion-contract.md` with `cmd:` / `pass:` lines before round 2.
