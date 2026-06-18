# AIV Pre-Commit Hook Rules

`<aiv.cli> init` (from aiv-protocol) installs a **pre-commit hook** that enforces an Atomic Commit Policy. The hook is owned by the protocol, not by this skill - don't reach into its implementation path or rewrite its matching logic. What this companion captures is the *behavior* you need to anticipate so you don't waste commit attempts. The exact regexes and rule numbers are the protocol's; if the hook rejects, read its message and fix the staging set.

## The shape: 1 functional file + 1 packet

The hook classifies each staged path as **functional**, **packet**, or **neither**, then enforces that a commit is one of a small set of allowed combinations. The canonical unit is **one functional file + one verification packet**.

- **Packet** = a `VERIFICATION_PACKET_*.md` file under the packets dir (`aiv.packets_dir`, default `.github/aiv-packets`).
- **Functional** = source / engine / scripts / tests / CI-workflow / enumerated root configs - the code-carrying surfaces the protocol's allow-list names. It is an allow-list, not allow-similar: a path counts only if explicitly enumerated.
- **Neither (non-functional)** = data files, ad-hoc root configs not on the allow-list, output dirs, docs the project doesn't treat as functional. These pass through as **solo** commits without needing a packet.

**⚠️ Critical consequence:** a non-functional file **CANNOT be paired with a packet** in one commit. The atomic unit is "1 functional + 1 packet"; any other 2-file combination is rejected. So `<some-config>.ts + packet`, `tsconfig.json + packet`, `README.md + packet` all fail with a "too many / disallowed file combination" message when those paths aren't on the functional allow-list. The workaround is a two-commit split (see *Pattern: Non-functional config + packet*, below).

## The allowed combinations (in evaluation order)

| Allowed | Notes |
|---|---|
| dependency manifest + lockfile (e.g. `package.json + package-lock.json`) | dependency-pair exception; no packet |
| 1 functional file + 1 packet | the canonical AIV atomic unit |
| packets-dir bootstrap marker + 1 packet | first packet in a fresh dir |
| submodule path + 1 packet | submodule update |
| `.gitmodules` + submodule path + 1 packet | submodule add (3 files) |
| 1 packet alone | packet-only edits (seed, SHA pinning) |
| 1 file alone, not functional, not packet | data / non-functional configs |

| Rejected | Why |
|---|---|
| >2 files staged (outside the explicit multi-file allowances) | atomic violation |
| a functional file with no packet | the trap - prints the "code without evidence" rubric |
| any other 2-file combination | including two data files together |

After a successful staging check, the hook also runs `lint-staged` (linter + formatter on staged source/markdown/JSON). That step can still fail or rewrite files - see Failure modes.

## Common patterns

### Pattern: First commit of a multi-file logical unit

The first commit creates the packet alongside the first functional file:

```bash
git add engine/commands/dump.ts "$PACKETS_DIR"/VERIFICATION_PACKET_DUMP_FINDINGKIND.md
git commit -m "feat(dump): add --finding-kind option with schema whitelist"
```

### Pattern: Subsequent commits sharing the same packet

The packet must be staged again. Touch a CLM "satisfied at commit X" line so the diff is real:

```bash
# Edit the packet - flip one line to record commit progression.
git add tests/validate-evidence-anchors.spec.ts "$PACKETS_DIR"/VERIFICATION_PACKET_DUMP_FINDINGKIND.md
git commit -m "test(extract): regression for --finding-kind whitelist"
```

### Pattern: Test file has hunks for multiple units

Use `git add -p` to split:

```bash
git add -p tests/some-test-file.spec.ts
# Stage only the hunks belonging to this unit; skip (n) the others.
git add "$PACKETS_DIR"/VERIFICATION_PACKET_<UNIT>.md
git commit -m "..."
```

The unstaged hunks remain in the working tree for their own unit's commit.

### Pattern: Data / non-functional file commits (no packet needed)

```bash
git add data/tracker/audits/crewai.json
git commit -m "data(tracker): refresh crewai gate state after sync"
```

One non-functional file at a time. Two data files together are rejected as a disallowed 2-file combination. Different data files are separate commits even if they refresh together.

### Pattern: Dependency bump

```bash
git add package.json package-lock.json
git commit -m "deps(test): add vitest + fast-check + coverage-v8"
```

No packet needed - the dependency-pair exception covers this. Use it sparingly; if the manifest change also drags in test files or code, those are separate atomic units.

### Pattern: Packet-only update (e.g., post-PR-time SHA pinning)

```bash
git add "$PACKETS_DIR"/VERIFICATION_PACKET_DUMP_FINDINGKIND.md
git commit -m "aiv(packet): pin commit SHAs for DUMP_FINDINGKIND"
```

The "1 packet alone" allowance covers this.

### Pattern: Non-functional config + packet (the two-commit split)

When a unit's primary file is a non-functional config (a config not on the allow-list, `tsconfig.json`, an ad-hoc root file, etc.), the "1 functional + 1 packet" unit is unavailable. The only way to attach a packet is to split into two commits:

```bash
# Step 1: seed the packet via the packet-only allowance
git add "$PACKETS_DIR"/VERIFICATION_PACKET_<UNIT>.md
git commit -m "aiv(packet): seed <UNIT> packet"

# Step 2: commit the non-functional file solo (fall-through, no packet)
git add path/to/config.ts
git commit -m "<scope>(<area>): <change>

Packet Source: $PACKETS_DIR/VERIFICATION_PACKET_<UNIT>.md"
```

The packet exists from Step 1 onward; Step 2's commit message references it via a `Packet Source:` line so an auditor can trace the unit. The packet's §0 should explicitly note this two-commit structure so the unit boundary is visible.

This pattern bites people because intuition says `<config>.ts + packet` should be a valid atomic unit. It isn't unless that path is on the functional allow-list - only enumerated files count.

### Pattern: Multi-file mechanical sweep batch

A single logical change applied verbatim across N files (e.g., a host substitution `oldhost.example` → `newhost.example` repeated across N docs files). One packet covers the full sweep; N functional commits each pair with a per-commit packet update.

```bash
# Step 1 - seed the packet with claims, classification, file inventory.
# Leave the SHA-log table EMPTY (header rows only). Pre-populating it
# defeats the atomic-unit rule on every subsequent commit - see ANTIPATTERNS.md H5.
git add "$PACKETS_DIR"/VERIFICATION_PACKET_<UNIT>.md
git commit -m "aiv(packet): seed <UNIT> packet (R<N> / S0 with documented waiver)"

# Step 2..N+1 - for each file in the sweep:
PACKET="$PACKETS_DIR/VERIFICATION_PACKET_<UNIT>.md"
for FILE in <file-list>; do
  printf "| (this commit) | \`%s\` |\n" "$FILE" >> "$PACKET"
  git add "$FILE" "$PACKET"
  git commit -m "<scope>(<area>): <one-line> in $FILE

Packet Source: $PACKET" || break    # fail-fast on first hook rejection
done
```

**Critical loop hygiene:**

- **`|| break` on commit failure.** If a commit fails inside the loop, the staged set persists into the next iteration. Without `|| break`, iteration N+1 stages `$FILE_{N+1}` on top of the already-staged-and-failed `$FILE_N + $PACKET`, producing a 3-file staging that hits the "too many files" rejection. Every subsequent iteration then fails for the wrong reason. Always halt on first failure and diagnose before retrying.
- **Per-iteration packet diff must be unique.** The `printf` above writes the file path into the row - that's what makes the packet diff unique per iteration. Rows that look identical across iterations (e.g., a date-only marker without the filename) can be silently coalesced by the formatter inside lint-staged; see Failure modes below.
- **Confirm progress at the end.** After the loop, run `git log --oneline | grep <unit-marker> | wc -l` to confirm N commits actually landed. A passing commit and a rejected one look similar in fast-scrolling output.

Class C of the unit's packet should include the falsifiable URL-only / pattern-only assertion plus the verification command (e.g., `git diff <files> | grep -vE "<expected-pattern>"` returning empty for every file in scope). Without that, "no other prose was touched" is just an assertion.

### Pattern: Multi-commit unit beginning with a deps pair

The dependency-pair exception does not allow a packet to be staged alongside it. If your unit's first commit is a deps pair, you can't establish the packet there. Two workarounds:

**(a) Seed the packet first via the packet-only allowance (preferred):**
```bash
git add "$PACKETS_DIR"/VERIFICATION_PACKET_<UNIT>.md && git commit -m "aiv(packet): seed <UNIT> packet"
git add package.json package-lock.json && git commit -m "deps(...): ..."
# subsequent functional commits in the unit pair with the packet
```

**(b) Place the packet with a later functional commit.** The early deps commit doesn't reference the packet via `Packet Source:` (the file doesn't exist yet at that commit's tree). Acceptable but more confusing for auditors - variant (a) is preferred.

## Failure modes

### Hook prints the "code without evidence" rubric

You staged a functional file without staging a packet. Either:
- Add a packet, OR
- Move that file to a different commit if it doesn't belong with the current unit.

Don't `--no-verify`. The rubric exists to force packet authorship.

### Hook rejects "too many files"

You staged 3+ files outside an explicit multi-file allowance. Almost always means hunks from multiple units got bundled. Run `git status` and unstage the unrelated files (`git restore --staged <path>`). Re-stage as separate atomic units.

### Hook rejects a 2-file combination

Two staged files but neither matches an allowed pair. Common causes:
- Two data files staged together → split to separate commits.
- Functional file + non-packet markdown staged → write a packet.
- Packet + non-functional file staged → the non-functional file commits solo (two-commit split above).

### lint-staged fails

Pre-commit got past atomicity but the linter or formatter failed on a staged file. Investigate the actual error; don't `--no-verify`. Common: formatting drift, a lint-rule violation, broken imports. Fix and re-stage.

### lint-staged silently drops a tiny packet edit (the worst-of-both)

Pre-commit reports success - the commit is created - but `git show <sha> --name-only` shows only the functional file, not the packet. The packet diff was silently dropped somewhere in the lint-staged → format → re-stage flow.

**When it happens:** the per-commit packet edit is very small (e.g., a single new row in a markdown table) and the formatter reformats the surrounding context (re-pads cell widths, normalizes hyphens) in a way that overlaps the staged hunk. lint-staged then re-stages the formatter's version, which can lose the original append.

**Detection:** after each commit in a multi-file unit, sanity-check with `git show <sha> --stat`. If the file count is 1 instead of 2, the packet update was dropped. Don't proceed with the next commit until the packet state is reconciled.

**Mitigation:** make the per-commit packet diff *substantive enough that the formatter can't blur it.* The append-a-unique-filename-row pattern in *Pattern: Multi-file mechanical sweep batch* is the simplest reliable shape. If you observe a drop:

- Note the dropped commit's SHA explicitly in the commit message of the next commit (e.g., `NOTE: packet-row-update for <SHA> was lost in lint-staged; backfilled below.`).
- The next commit's packet diff should add both the missed row and the new row.

### Loop-batch staging is cumulative on commit failure

Running a shell loop that does `git add file packet && git commit ...` for each item in a sweep: if any commit fails, the failed commit's staged set persists into the next iteration. Iteration N+1's `git add` adds its files *on top of* iteration N's already-staged set, producing a 3+ file staging that hits the "too many files" rejection. Every subsequent iteration fails for the wrong reason, masking the original failure.

**Detection:** after a loop run, count successful commits with `git log --oneline | grep <unit-marker> | wc -l` and compare to the file count. Mismatch means at least one iteration failed.

**Mitigation:**

- Always `|| break` on the commit step inside the loop (or `|| { ...diagnostic; break; }`).
- After a partial failure, run `git reset HEAD` to clear the accumulated staging, diagnose the original first-iteration error, then resume.
- Don't add `git reset HEAD -- .` *between* iterations as a defensive measure - that hides per-iteration partial-failure signal, and the next file's success masks the failure of the prior file.

## What the hook does NOT enforce

- Packet quality (CLMs, evidence classes). That's this skill's job; `aiv check` validates packet *shape*.
- Commit message format. Conventional Commits is a convention, not a hook rule.
- Branch naming. The operator's responsibility.
- That commits land on a feature branch vs the default branch. The hook fires the same on either.
