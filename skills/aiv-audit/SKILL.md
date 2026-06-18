---
name: aiv-audit
description: Audit existing AIV verification packets on a PR branch against the normative AIV spec for claim-evidence correspondence, packet self-containment, and risk-tier/evidence-class consistency - the content checks a shape validator cannot do. **Also actively harvests the missing evidence that's collectible** (CI run permalinks, captured grep output, SHA-bound diffs, sha256 manifests) and attaches it as ready-to-paste material in the audit comment - diagnose AND collect, not diagnose-only. Distinct from packet authoring (designs new packets) and the `aiv check` shape validator (structural gate). Use when the user asks to "audit the AIV packets", "is the AIV evidence high quality", "do the packets meet the spec", "does the evidence actually support the claims", or after a PR has shipped packets and the operator wants a content-quality audit beyond shape. Output: spec-finding-form findings + harvested-evidence appendix + remediation options, posted as a single PR comment.
---

# AIV spec audit - content, not shape

Packet authoring builds packets. `aiv check` enforces packet *shape* (headers, structure, pairing) at commit time and in CI. This skill audits **packet content** against the AIV spec after the PR is open.

A shape gate confirms the packet exists and is structurally valid. Passing it does **not** mean the packet would survive a real auditor reading it. This skill is that auditor: it checks whether the cited evidence actually supports the claims, whether each packet stands alone, and whether the risk tier and evidence classes are internally consistent. Then it **harvests the collectible missing evidence** so the audit is actionable, not just diagnostic.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via `$AIV_WORKFLOW_CONFIG`). Keys used: `aiv.cli` (default `aiv`), `aiv.spec_path` (default `aiv-protocol/SPECIFICATION.md`), `aiv.packets_dir` (default `.github/aiv-packets`), `aiv.check_cmd` (default `aiv check`), `evidence.mandate_all_classes` (default `true`), `evidence.exclude_classes` (default `[G]`), `branch.base` (default `origin/main`). If the file is absent, use these defaults and say so.

> **Read the spec, don't restate it.** This skill does NOT hardcode section numbers, class-by-tier tables, or finding-ID strings. Open `aiv.spec_path` and read the actual risk-classification section, the evidence-class definitions, and the immutability/retention requirements for *this* project's spec version. Cite the sections and finding IDs the spec actually uses. Where a section is referenced below it is named by its role ("the risk-classification section", "the Class A / Execution definition"), not a fixed number - resolve the number from the spec at audit time.

## When to invoke

- User asks: "is the AIV evidence high quality", "do these packets actually support the claims", "audit the packets against the spec", "does the evidence match the claims"
- Follow-up after a review that only checked packet shape
- Before declaring AIV conformance for a release
- When a packet self-classifies at a low risk tier on code that touches a critical surface named in the spec's risk-classification section

## When NOT to invoke

- During packet authoring - that is the packet-authoring skill
- For shape-only checks (headers, structure, pairing) - `aiv check` already covers this; run it, don't re-derive it
- For non-AIV repos (no spec at `aiv.spec_path`, no packets under `aiv.packets_dir`)

## What `aiv check` already does (don't redo it)

Run the configured shape validator first and read its output:

```bash
<aiv.check_cmd> <packet> --strict --audit-links
```

It validates structure, required headers, and link auditability. **This skill focuses on what the validator does NOT do:**

1. **Claim-evidence correspondence** - does each cited artifact actually support the claim it is attached to?
2. **Self-containment** - does each packet stand alone, or does it form a forward-reference chain across commits?
3. **Tier/class consistency** - is the self-declared risk tier defensible given what the change touches, and are the evidence classes the spec requires at that tier all present and non-vacuous?
4. **Evidence harvest** - collect the collectible missing evidence as paste-ready material.

If a shape problem surfaces, note it and point at `aiv check`; do not duplicate its job.

## Inputs

- A PR number or branch name with one or more packets under `aiv.packets_dir`
- The canonical spec at `aiv.spec_path` (verify the version; sections and finding IDs may shift across revisions)

## Phases at a glance

1. Locate spec + packet set; run `aiv check` for shape
2. Read the spec's risk-classification + evidence-class sections
3. Tier audit - is the declared tier defensible?
4. Evidence-class completeness vs the spec's per-tier matrix (all-class mandate)
5. Claim-evidence correspondence
6. Self-containment + immutability cross-check
7. **Evidence harvest** - collect missing evidence that's collectible (read-only)
8. Output as a single PR comment

The audit is **read-only end-to-end**, but read-only includes *collecting* evidence (running greps, capturing CI URLs, hashing local artifacts). It does not include amending packets. See Phase 7.

## Phase 1 - Locate spec + packet set, run the shape validator

```bash
ROOT=$(git rev-parse --show-toplevel)

# Packets touched on the PR branch (all commits, NOT just at HEAD)
git log <branch.base>..origin/<branch> --name-only --pretty=format: \
  | grep "$(yq '.aiv.packets_dir' .aiv-workflow.yml 2>/dev/null || echo .github/aiv-packets)" \
  | sort -u
```

Run `<aiv.check_cmd>` over each packet first and record its verdict. Shape failures are the validator's findings; this skill builds on top of a clean (or noted) shape result.

## Phase 2 - Read the spec sections you will cite

Open `aiv.spec_path` and read:

- **Risk classification** - the critical-surfaces list and the blast-radius ladder. Note the exact tier names this spec uses.
- **Evidence classes** - the definition of each class (A-F) and the per-tier requirement matrix (which classes are mandatory at which tier).
- **Immutability / retention** - what makes a reference immutable (commit-SHA permalink, signed attestation, hashed snapshot) vs mutable (branch URL, "latest", an unsnapshotted issue).
- **Evidence-item structure** and any **exception** provision (most specs permit a documented exception path - surface it in recommendations).

Quote the spec **verbatim** when you cite it. Resolve every finding ID from the spec, not from memory.

## Phase 3 - Tier audit (the load-bearing check)

A misclassification cascades into evidence-class gaps, so this is the most important finding. For each packet:

1. **Does the change touch a critical surface the spec's risk-classification section enumerates?** Common surfaces: authentication, **authorization** (permission checks, role assignment, ACL/allowlist edits - the most-missed one), secrets, cryptography, financial, PII, privilege boundaries, audit/logging.
2. **If yes,** the spec typically mandates the top tier *regardless of blast radius*. A lower self-declaration fires the spec's tier-misclassification finding.
3. **If no,** evaluate blast radius against the spec's ladder (local → component → service → cross-service → org) and confirm the declared tier matches.

> **Authorization landmine:** a change that merely *adds entries to* an access-control structure (allowlist, role map, ACL rule set) is still authorization config. Authors often declare it low-tier because "it's additive" - specs generally do not carve out additive ACL edits. Check the spec's wording rather than assuming.

Record the finding using the spec's own ID for tier misclassification, naming the surface and the cascading effect.

## Phase 4 - Evidence-class completeness (all-class mandate)

When `evidence.mandate_all_classes` is true, **every packet addresses classes A-F**, with classes in `evidence.exclude_classes` (default `[G]`) omitted. A class that genuinely does not apply gets an explicit, falsifiable **N/A rationale** - a vacuous or empty class section fails the same bar as a missing one. This is the same mandate the evidence-engine (build-side) skill enforces; here you audit whether the shipped packets met it.

Read the spec's per-tier matrix to know which classes are *mandatory* at the declared tier, then for each sampled packet check both the mandatory floor and the all-class address. Sample 3-5 packets spanning the change shapes present (e.g. one functional fix, one new spec/doc, one new test).

For each class, audit against the spec's definition (resolve the exact criteria from `aiv.spec_path`):

- **A - Execution.** Is the test/run evidence bound to an *immutable* reference (commit-SHA CI permalink or signed attestation), not a branch URL? Does the run's SHA match the packet's head SHA? Are pass/fail/skip *counts* present (not just "tests pass")? Watch for **future-tense / forward-reference** evidence ("deferred to a later commit", "expected: 5/5") - a packet must capture evidence as of its own commit.
- **B - Referential.** Do code links resolve to an exact commit SHA, not a branch? Are line anchors present per claim? Does the scope inventory match the `git diff` file list?
- **C - Negative** (when the spec requires it at this tier). Is the search scope explicitly declared (paths/modules/patterns)? Is the method deterministic (tool + version + config)? Are patterns enumerated, not "checked for issues"? A common miss: a grep/typo sweep was done in-session but its invocation/output was never captured.
- **D - Differential** (when required). Is there differential evidence for *each* surface category touched (API, deps, schema, config, security), not just one? Are diffs bound to both base and head SHA? Are raw artifacts present, not only inline summaries?
- **E - Intent.** Is the requirement reference immutable per the spec (commit-SHA-bound spec-in-repo, hashed snapshot, version-tagged issue)? Common miss: a plan/design doc in an operator's home dir or a "live-prod screenshot" cited with no hash and no immutable URL.
- **F - Provenance** (when required). Is there at least one cryptographic provenance mechanism (signed commit, CI OIDC attestation, SLSA predicate, notarization), bound to the packet's head SHA? Are SHA-256 hashes recorded for the cited artifacts? Bare git commit SHAs prove commit integrity but not evidence-artifact integrity.

Distinguish **BLOCK** vs **WARN** strictly per the spec's severity column. Do not escalate WARNs to BLOCKs or vice versa.

## Phase 5 - Claim-evidence correspondence

For each claim in each sampled packet, build a table:

| Packet · Claim | Embedded evidence | Supports claim? |
|---|---|---|

Mark each row ✓ / ✗ / partial. Patterns that mark ✗:

- **"Verified by visual inspection"** with no captured output
- **"grep / `ls` showed ..."** with no captured stdout
- **Forward-reference to a later commit's packet** ("coverage in a later commit") - defeats self-containment
- **Narrative-only claims** with no class-A/B/D artifact tying back

Per-packet, per-claim findings carry far more weight than blanket statements. "Packets X/Y/Z carry future-tense Class A" lands; "Class A is weak" does not.

## Phase 6 - Self-containment + immutability cross-check

- Do packets stand alone, or do they form a forward-reference chain (commit 0 → 1 → 2 …)? A chain that ultimately covers a claim is still a self-containment failure.
- Are all cited artifacts immutable per the spec? Branch URLs, "latest" links, and unsnapshotted issue trackers fail.
- Are any home-dir-rooted (`~/`) paths cited? Those are by definition outside the repo and mutable.

## Phase 7 - Evidence harvest (DO THIS - don't just diagnose)

**This is the skill's core value.** The audit is far more useful if you collect the missing evidence that is collectible, not just list what is missing. Most missing evidence on a typical PR already exists somewhere - the CI run finished, the grep produces deterministic output, the commit diff is reproducible. The auditor is the cheapest person to capture it because the artifacts are already open. The packet author can then paste your output into an amendment packet (or an exception document) without re-doing the work.

For each finding ask: **"Could I run a read-only command right now that would produce the missing evidence?"** If yes, do it and attach the captured output. This is still read-only - you are collecting, not amending. Amendment is the operator's call.

Harvest checklist (map each row to the spec's actual finding ID for that gap):

| Gap | Read-only harvest |
|---|---|
| No immutable CI run ref | `gh run list --branch <branch> --limit 5 --json databaseId,headSha,conclusion,url,workflowName` → capture the run URL + headSha for the PR's HEAD; if green and bound to head SHA, that closes the Class A immutability gap |
| No pass/fail/skip counts | If CI ran: `gh run view <run-id> --log` (capture the test-summary line). If local-only is acceptable, run the project's `ci.test_cmd` with a JSON reporter to a file and record the file's SHA-256 |
| Refs not commit-SHA-bound | Build the canonical `https://github.com/<org>/<repo>/blob/<head_sha>/<path>#L<n>-L<m>` URL for each cited file:line; verify it resolves |
| No search scope/method/results (Class C) | Re-run the audit grep the packet *claims* was performed: `git grep -nE '<pattern>' <branch> -- '<scope>'` - capture invocation + output; note git + version + grep/ripgrep used |
| No semantic test-integrity report | `git diff <base>..<head> -- '<test-globs>'` to surface assertion deltas; for coverage run `ci.test_cmd` with a coverage reporter if cheap |
| Diff not SHA-bound (Class D) | `git diff <base-sha>..<head-sha> -- <touched-file>` captured to a patch file, with both SHAs printed in the header - that IS the canonical Class D artifact |
| Raw artifacts missing (Class D) | Same patch file is the raw artifact |
| Mutable requirement reference (Class E) | If the local plan/doc exists, capture its SHA-256 + last-modified ISO timestamp and propose moving it into the repo (e.g. `docs/plans/<name>.md`) referenced by the resulting commit SHA; for screenshots, locate the artifact and capture its SHA-256 |
| No cryptographic provenance (Class F) | `gh attestation list --repo <org>/<repo>` if Sigstore is wired; `git log --show-signature -1 <head_sha>` for commit signatures; capture whichever exists |
| No SHA-256 for evidence (Class F) | For every cited file/artifact you DID resolve: `sha256sum <file>` - capture all hashes in a table |

**What to attach to the comment** - a final section titled `### Harvested evidence (read-only - attach to amendment packet)`, e.g.:

```markdown
**<spec finding ID> remediation - CI run permalink for head_sha `<sha>`:**
- URL: <captured gh run URL>
- Conclusion: success / failure
- Workflow: <name>
- Satisfies the Class A immutability requirement if appended to packets <x>, <y>.

**<spec finding ID> remediation - search invocation + output:**
\`\`\`bash
$ git grep -nE '<pattern>' <head_sha> -- '<scope>'
<captured output>
\`\`\`
Tool: git <version>; pattern: `<pattern>`; scope: `<scope>`.
Result: <0 hits | N classified hits>.

**<spec finding ID> remediation - SHA-bound diff:**
\`\`\`bash
$ git diff <base_sha>..<head_sha> -- <path>
<captured diff>
\`\`\`

**<spec finding ID> remediation candidate - mutable-reference snapshot:**
- Local SHA-256: `<hash>`
- Last modified: `<ISO timestamp>`
- Recommendation: copy into the repo and reference by the resulting commit SHA. (Operator action - outside the read-only scope of this audit.)

**<spec finding ID> remediation - SHA-256 manifest:**
| Path | SHA-256 |
|---|---|
| <path> | <hash> |
```

**Be explicit about what harvest does NOT do:**

- It does NOT edit packets - that is the operator's call (or a follow-up packet-authoring session).
- It does NOT decide whether the gathered evidence "rescues" the packet - the operator + the spec do.
- It does NOT include anything requiring write access (no attestation *creation*, no signing, no force-push, no hashing of files the harness cannot already read).
- If a finding has no read-only harvest path (e.g. no signing infra exists yet), say so explicitly: "**No read-only harvest path - requires infra build-out.**"

**When harvest is wasted work, skip it:**

- If the tier-misclassification finding is the operator's call and they are likely to file an exception, harvesting the classes that exception moots is wasted - note "Harvest deferred pending tier decision."
- If the PR is days from merge, the operator may bank the audit as a process-improvement signal; harvest stays useful but lower-priority.
- Use judgment. The point is to make the audit *actionable*, not to mechanically harvest everything.

## Phase 8 - Output: a single PR comment

Post **one** comment via `gh pr comment <N> --body-file <file>` (write the body to a temp file first to preserve formatting). Structure:

```markdown
## AIV spec audit - PR <id> (content audit; follow-up to shape review)

Shape (`aiv check`) was verified separately. This audit verifies packet *content*
against the spec at `<aiv.spec_path>` (version <X>).

**Scope sampled:** packets <x>, <y>, <z> (functional + spec + test).
**Headline:** <one sentence - the load-bearing finding>.

### Finding 1 - tier misclassification (<spec finding ID>) - BLOCK if conformance is claimed
<quote the spec verbatim; cite the specific code that triggers the critical-surface rule; describe the cascading effect on required classes>

### Finding 2 - Class A (<spec finding IDs>) across <which packets>
<per-packet table>

### Finding 3 - Class E (<spec finding ID>) - mutable reference
<list mutable references found>

### Finding 4 - Classes C / F (which fire IF Finding 1 is upheld vs overridden)

### Finding 5 - Class D (<spec finding ID>) - diff not bound to specific commit SHAs

### Claim-evidence correspondence
<per-claim ✓/✗ table>

### Summary table
<dimension → status>

### Harvested evidence (read-only - attach to amendment packet)
<per-finding harvest blocks per Phase 7>

### Recommendations (operator decides; this comment is read-only)
1. **Escalate the tier + amend packets** - paste the harvested-evidence blocks above into amendment packets (highest fidelity).
2. **File a documented exception** per the spec's exception provision - harvested evidence supports the exception rationale (lowest cost, spec-permitted).
3. **Record the deviation in the packet's known-limitations** - cheapest; not conformance.

- Generated by aiv-audit, read-only (audit + evidence harvest).
```

## Output style rules

- **Cite spec sections verbatim**, with the spec's own section number + finding ID resolved from `aiv.spec_path`. Auditors recognize the IDs; prose summaries get ignored.
- **Per-packet evidence beats blanket statements.** A finding tied to specific packets carries weight.
- **Distinguish BLOCK vs WARN** per the spec's severity column. Never re-grade.
- **Always offer the exception path.** The spec permits documented exceptions for a reason. Audit ≠ block-merge.
- **Read-only.** Never amend packets, never comment-merge, never close the PR. Output is a single PR comment. The operator decides whether to remediate.

## Safety rails

- This skill posts a **single** PR comment via `gh pr comment` - never bulk-comments, never opens issues.
- **Harvest is read-only by definition** - capture artifacts, hash files you can already read, compose URLs, run greps and `gh run list` / `gh run view --log`. Never create attestations, never sign, never write into `aiv.packets_dir`.
- The harvested evidence is *ready-to-paste material* for the operator (or a follow-up packet-authoring session). Amendment is a separate concern.
- Never claims AIV conformance on the operator's behalf. The skill produces *findings* + *harvested evidence*; the operator (or a designated exception approver per the spec) decides conformance.
- If harvest would require running the full test suite from scratch, **stop** and use static signals (existing CI logs, captured diffs, grep) instead. Re-running an entire suite to manufacture Class A is theater, not harvest.

## Principles this skill enforces (universal, not project-specific)

- **A clean shape check is not a clean content check.** "Validator passed" means structurally valid, not that the evidence supports the claims. If the content audit comes back clean too, add the measurement dimension that would have caught a defect, then re-run.
- **Self-containment is non-negotiable.** A packet that only makes sense as part of a forward-reference chain is not auditable in isolation, even if the chain eventually covers the claim.
- **Even a PASS audit does not authorize merge.** This skill is read-only and produces findings; the human remains the merge gate. Never auto-merge on a clean audit.
