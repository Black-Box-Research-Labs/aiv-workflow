# AIV Packet Antipatterns

Theater patterns that look like compliance but aren't. The AIV spec calls these out by name (the *Verification Theater* section of `aiv.spec_path`). If you catch yourself doing any of them, redraft. The rule IDs below are the spec's; let `aiv check` (the configured `aiv.check_cmd`) tell you which one fired rather than memorizing them.

## A. Class A theater

### A1. "Tests pass" without counts (BLOCK)

❌ "All tests pass."
❌ "CI green."
❌ "✓ Tests passed"

✅ "suite `validate-evidence-anchors.spec.ts`: 6 tests, 4 passed, 2 failed (pre-existing - see §4 limitations 2), 0 skipped, 4.8m wallclock. Test list:"
   followed by an enumerated list of test IDs and per-test results.

### A2. Build success as a stand-in for behavior verification

❌ "Class A: the build exited 0."

A green build proves the code compiles. It does not prove the change does what the claim says. Class A artifacts must exercise the **behavior under test**, not just the build pipeline.

✅ The Class A artifact is the test that would fail if the claim is false. If no such test exists, the gap is real and goes in §4 limitations (or fix it before claiming).

### A3. CI run link to the wrong commit (BLOCK)

❌ Pasting a CI run from the default branch when the packet's `head_sha` is the feature-branch commit.

The CI run's commit must equal the packet's head SHA. Pre-PR, this is a placeholder; at PR-time the placeholder is replaced with the real run.

### A4. Hashing scraped HTML (BLOCK / WARN)

❌ `sha256(downloaded HTML of the CI page)`.

HTML pages contain dynamic elements (timestamps, ads, session tokens) that change every retrieval. The hash never reproduces. Use API exports, framework JSON, or downloaded artifacts instead.

## B. Class B theater

### B1. Permalinks to the file, not the lines (BLOCK at R2+)

❌ `https://<host>/<owner>/<repo>/blob/SHA/path/to/file.ts` - supports the claim "this file changed" but not the actual claim.

✅ `https://<host>/<owner>/<repo>/blob/SHA/path/to/file.ts#L2839-L2842` - anchors to the lines that establish the claim.

### B2. Branch links instead of SHA links (BLOCK)

❌ `/blob/main/...`, `/blob/feature-branch/...`

The whole point of the packet is auditable evidence at a frozen state. Branch links are mutable; tomorrow they show different content. Always commit-SHA-pin.

### B3. One blanket link for all claims (BLOCK)

❌ "All claims supported by the diff at `<single-link>`."

Each CLM gets its own evidence reference. The spec mandates ≥1 referential evidence item per claim. A blanket link doesn't survive an auditor asking "which claim does this support and at which line".

### B4. Permalinks to *future* commits

❌ Citing the test added in commit 2 as evidence for commit 1.

The packet is evidence for what is true *at* the commit, not after subsequent commits. If the test isn't in the working tree at commit-time, it can't support the claim.

## C. Class C theater (R2+)

### C1. Grep as the sole regression check (BLOCK)

❌ "Searched for `findingKind` references; no callers broken."

A grep finds string occurrences. It can't tell you whether the calling code's *behavior* is preserved. The spec explicitly forbids string matching as the sole verification method at R2+. Use AST diff, coverage delta, or framework JSON output.

### C2. "Negative evidence" with no enumerated patterns (BLOCK)

❌ "Checked for issues, none found."

What patterns? What scope? What tool? The spec requires an explicit enumeration. "Issues" is not a pattern.

### C3. Coverage didn't decrease (claim) without coverage report (evidence)

❌ "Coverage was preserved."

Cite the actual coverage delta artifact (Istanbul JSON, lcov diff, framework report). "Was preserved" without artifact is unverifiable.

## D. Class E theater

### E1. Mutable issue link with no snapshot obligation (WARN under transitional pathway; BLOCK under strict)

❌ "Spec: https://linear.app/team/issue/T-1234"

Linear/Jira/issue-tracker URLs are mutable. Under the transitional pathway you can use them *with* a snapshot-obligation block recorded in the packet; under strict conformance they're forbidden.

### E2. "The diff" as the intent reference

❌ "Class E: see the diff."

The diff shows what changed; intent shows *why*. The two are different artifacts. Cite the directive (commit, spec file, issue snapshot) that prompted the change.

### E3. Self-referential intent

❌ Class E links back to the same packet.

The packet justifies itself by pointing at upstream intent. Pointing at itself is circular.

## E. Class G theater

### G1. Post-hoc prediction (BLOCK)

❌ Writing the "Black Box Prediction" document *after* reading the implementation, then back-dating it.

The spec names this as gaming. The whole point of Class G is that prediction precedes review - the timestamp is load-bearing. Class G is excluded by default (`evidence.exclude_classes`); if you didn't predict before reviewing, omit it entirely and state the omission honestly in §4 limitations.

### G2. Generic mental trace ("the function reads input, processes it, writes output")

The trace must reference specific lines and functions. A generic description doesn't prove comprehension; it proves nothing.

### G3. Checkbox edge cases ("considered: empty input, null, malformed")

The probe needs prose descriptions of what would happen, not bullet points. ≥3 edge cases with how-the-code-handles-them, ≥1 failure mode.

## F. Classification theater

### F1. Tier picked by file count instead of criteria

❌ "Small change, R0."
❌ "Lots of files, R3."

The spec classifies by *what* changed, not *how much*. A 2-line change to auth code is R3. A 200-line refactor of internal helpers may be R1.

### F2. Critical surface in scope but tier ≤ R2

If the spec lists a critical surface (auth, crypto, secrets, payments, PII, audit logs, privilege boundaries), the change is R3. No exceptions. R2 + "but it's a really small change" is non-conformant.

### F3. SoD violation with AI as the second person

❌ "Author: <human>; Verifier: <AI agent>" on an R2+ change.

Per the spec, the AI agent is *not* a different natural person from the human directing it. R2+ requires two different humans. If you're solo on R2+, either halt and escalate to a human verifier, or document the non-conformance via the spec's exception/waiver pathway (see SKILL.md Phase A, path 2).

### F4. Self-classification rationale that just restates the tier

❌ "classification_rationale: This is R1 because it's R1."
❌ "classification_rationale: Low risk."

The rationale must cite the spec's tier criteria and explain why neighboring tiers don't apply. If it can't, the classification isn't yet justified.

## G. Coverage / known-limitations theater

### G1. "Comprehensive test coverage" without checking what's covered

❌ Claiming R1's "comprehensive test coverage" criterion when the new code path has no test exercising it.

Either add the test (preferred - fix gaps immediately, don't accumulate debt), or list the coverage gap honestly in §4 limitations and consider whether R1 still applies.

### G2. Missing limitations section / empty limitations section

A packet with no known limitations is suspicious. Real changes have:
- Deferred refactors
- Edge cases not tested
- Dependencies on other in-progress work
- Schema-drift risks
- Pre-existing failures observed

If the limitations section is empty, you didn't look hard enough.

### G3. Pre-existing failures absorbed silently

❌ Running the test suite, seeing 3 failures, claiming "tests pass" because the *new* test passes.

A failure that reproduces with `git stash push <test-file>` and re-running on HEAD is not yours - but it's not invisible either. Document it in §4 as observed-but-out-of-scope, with the isolation procedure used.

### G3.5. Trusting the diff line count to estimate substance

❌ Looking at `git diff --stat` showing "62 lines changed" and assuming there's substantive content change.

Formatters can produce large unified diffs from purely cosmetic reflows (multi-line strings reflowed, array element formatting changed) without altering parsed content. A `git diff --stat` line count is a *lower bound* on cosmetic effort, not an upper bound on semantic substance.

✅ For data files (especially JSON), always do a structural comparison:

```python
import json, subprocess
old = json.loads(subprocess.check_output(["git", "show", f"HEAD:{path}"]))
new = json.load(open(path))
removed_keys = set(old) - set(new)
added_keys = set(new) - set(old)
content_loss = [k for k in old.keys() & new.keys()
                if isinstance(old[k], str) and isinstance(new[k], str)
                and len(old[k]) > 50 and len(new[k]) < len(old[k]) // 2]
```

The `removed_keys` set is the load-bearing signal for data loss. A non-empty `removed_keys` on a data file with research content is a stop-the-line event - investigate before committing.

### G3.6. Silently propagating prior-session data loss

❌ Discovering during evidence harvest that the working-tree state has data lost in a prior session, and committing it anyway with a vague known-limitation note like "fields appear to have changed."

If the loss is recoverable from git history (e.g., a prior commit on the default branch or this branch), the AIV-conforming action is to recover the data and merge it into the current schema, then commit the merged result. The commit message attributes the recovery honestly: "recover X data lost in prior session via commit SHA Y." For data that merges (CRM records, dossiers, provenance chains), merge fields - never overwrite, never silently drop. Document the recovery as a CLM of the packet rather than burying it in known limitations.

### G4. Mislabeling working-tree state as "pre-existing on the default branch"

❌ Stashing only the test file (or only the file under test) when isolating a "pre-existing" failure.

A test runner sees the entire working tree, including untracked files. If your working tree contains an untracked config file with a typecheck error, and the test under investigation invokes a typechecker internally, the failure looks "pre-existing" but is caused by your own un-committed work.

✅ Before claiming a failure is pre-existing on the default branch:
- `git ls-files --others --exclude-standard` to enumerate untracked files
- Check whether ANY untracked file is reachable from the test's runtime path (typecheck targets, build inputs, schema resolvers)
- Either temporarily move untracked files aside, or check out the default branch in a worktree and reproduce there

## H. Process theater

### H1. Drafting the packet from the diff alone

The diff shows *what* changed; intent comes from outside the diff (git log, prior packets, spec files, directives). A packet derived solely from the diff has no Class E.

### H2. Reusing a packet whose name no longer matches

❌ Using `VERIFICATION_PACKET_PROMOTE_FINDINGKIND.md` for a `dump.ts` change "because it's the same program".

The pre-commit hook pairs ONE functional file with ONE packet per commit. If the packet name implies one file but the staged file is another, the audit trail is misleading. Cross-reference the related packet in the new packet's intent section, but write a new file.

### H3. Bypassing the hook with `--no-verify`

The hook is the enforcement mechanism. Bypassing it for "just this once" defeats the policy. If the hook rejects, the staging set is wrong - fix the staging set, never the hook.

### H4. Treating R0/R1 as "doesn't need a packet"

Under the all-class mandate, every functional commit needs a packet that addresses A-F. The lower tier reduces the *scrutiny* and which content rules fire, not packet existence or which classes appear.

### H5. Pre-populating the SHA-log section in the seed packet

❌ Drafting the packet's post-commit SHA-log table with all planned rows filled in (one per planned commit) before any of those commits exist, then committing the seed.

The packet seed is then a final state. The next functional commit tries to stage `<file> + packet`, but the packet has zero diff against HEAD - the seed already contained every row the unit will ever produce. With no real packet diff, the hook treats the staging as functional-only and rejects it. The unit deadlocks: every subsequent commit needs a packet edit that doesn't exist to make.

Symptom: every functional-file commit after the seed prints the "code without evidence" rubric, even though `git diff --cached --name-only` shows the packet path is staged.

✅ The seed packet is *under-populated* on purpose. Leave the SHA-log table with header rows only (or only fully-known historical entries), and append a single row per functional commit at commit-time. Each commit then produces a real, unique packet diff that pairs with the functional file:

```bash
# After seeding the packet via a packet-only commit:
printf "| (this commit) | \`%s\` |\n" "$file" >> "$PACKET"
git add "$file" "$PACKET"
git commit -m "..."
```

The "(this commit)" placeholder is fine pre-PR; pin the actual SHAs in a packet-only update at PR-time.

### H6. Retroactively committing a stale orphan packet

❌ Finding `VERIFICATION_PACKET_<X>.md` untracked in the working tree, noticing it documents work that already shipped in prior commits (without any packet at the time), and committing it as-is "for the audit record."

The packet's claim section asserts properties about a current commit's contents. A retroactively committed packet:

1. Names a `head_sha` that doesn't exist (or names a SHA that does exist but wasn't classified through this packet's process at commit time).
2. Will be evaluated by future auditors against the *current* state of the file paths it cites, not the historical state - so as the codebase evolves, the packet's CLMs drift to false.
3. Implies a verification process took place that didn't.

✅ Two recovery paths:

- **Delete the orphan and write a fresh packet for current work** at the same path/name (or a clearer one). The orphan never had a commit and never satisfied the hook; deleting it costs nothing.
- **If the documented work is genuinely re-verifiable now**, run the actual harvest against the current commit and write a *new* packet (likely with a different name, e.g., `<X>_RETRO_<DATE>`) that explicitly states it's a retro-classification, names the original commit SHAs in §0, and only makes claims that are still verifiable against current head.

## I. The meta-antipattern

### I1. Optimizing the packet for "passing the hook" instead of "surviving an audit"

The hook is mechanical: it counts files and matches regexes. An auditor reads the content. If your packet would pass the hook but make an auditor wince, you optimized for the wrong objective. Write packets that would survive an auditor; the hook is the floor, not the ceiling.
