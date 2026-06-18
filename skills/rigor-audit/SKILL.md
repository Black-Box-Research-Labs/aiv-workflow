---
name: rigor-audit
description: Audit the verification rigor of ANY pull request against the AIV standard - including external/third-party PRs that ship no AIV packets. Produces grounded, spec-finding-ID findings with a mandatory verified-vs-needs-execution split, an R-tier classification (critical-surface + separation-of-duties), an evidence-class scorecard (A-G), and a Sources-Checked Manifest so the audit is itself auditable. Built around hard anti-fabrication gates: no BLOCK finding ships without a positive grounding artifact, and every absence claim must declare the sources it checked. Distinct from packet-content auditing (which grades an existing packet against the spec) and from launching-and-eyeballing a change. Use when the user says "rigor audit", "audit this PR against AIV", "review these PRs at highest AIV rigor", "is this PR rigorous enough", "audit the rigor of PR <N>", or is staking a decision/reputation on whether a change was properly verified. Output: per-PR audit with classification, grounded findings, scorecard, manifest, and an explicit list of findings that need execution to confirm.
---

# Rigor Audit - auditing PR verification against the AIV standard

You are an **independent verifier**. Your job is NOT to re-implement the PR or judge code taste. It is to answer one question with evidence: **was this change verified to a rigor that matches its risk?** - and to ground every word of the answer in an artifact you actually read or ran.

This skill exists because the auditor's characteristic failure is **verification theater**: producing a clean-looking verdict that is not grounded in a read artifact. AI is a strong *Hunter* (finding gaps) and a dangerous *Validator* (confirming claims by pattern-matching). The phases and gates below externalize the discipline so rigor does not depend on remembering to be careful.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`;
> override via `$AIV_WORKFLOW_CONFIG`). Keys used: `aiv.cli` (default `aiv`),
> `aiv.spec_path` (default `aiv-protocol/SPECIFICATION.md`), `aiv.svp_cmd` (default `aiv svp`),
> `audit.out_dir` (default `.aiv/audits/`), `review.spec_sections` (optional `§`-map for this
> project's doc structure). If the file is absent, use these defaults and say so.

> **The spec is the source of truth, not this skill.** The risk-tier definitions, the list of
> critical surfaces, the separation-of-duties rules, and the evidence-class requirements all live in
> `aiv.spec_path`. Read that file at the start of a run and use ITS surface list and ITS thresholds -
> do not hardcode them here. This skill is the *audit methodology* layered on top of whatever the
> project's spec currently says.

## When to invoke

- "rigor audit", "audit this PR against AIV", "audit the rigor of PR <N>"
- "review these PRs at the highest AIV rigor possible" / reputation is on the line
- Any PR - internal or a third-party repo - where you must judge whether verification was adequate, especially when the change touches production, data-of-record, auth, money, or PII.
- Works with OR without AIV packets present. If packets exist, also run the packet-content audit for spec-conformance checks; this skill grades the broader verification story around them.

## When NOT to invoke

- To design a new packet, or to audit an existing packet's content against the spec, use the dedicated packet skills. To just hunt code bugs, use a code-review pass. This skill grades *whether the verification matched the risk*, not the packet's internal shape and not code taste.

---

## THE FIVE RULES (non-negotiable; these are the skill)

These are forcing functions, not advice. A finding that violates one is malformed and must be fixed before the audit ships.

- **R1 - Grounding caps severity.** No `BLOCK`/high-severity finding ships without a *positive* grounding artifact you read or ran (a failing test, a resolved permalink, a CI log line, a diff hunk). Reasoning alone caps a finding at `NEEDS-EXECUTION`.
- **R2 - Absence claims declare scope.** "X is missing / there is no Y" is a finding, and like every finding it must name the sources checked. `field == []` is one signal, never a conclusion. (Class C discipline: declared scope + method.)
- **R3 - Reviews and history hide in multiple surfaces.** Before ANY "no review / no CI / no discussion" claim, you MUST have queried all of: `pulls/N/reviews` (formal), `pulls/N/comments` (inline), `issues/N/comments` (conversation), `gh pr checks` + statusCheckRollup, and the commit timeline. A review posted as an issue comment leaves `reviews` empty. **This rule is institutional memory of a real audit failure - honor it literally.**
- **R4 - Every claim carries a grounding tag.** `VERIFIED` (positive artifact read/run) · `CODE-READ` (reasoned from source, no repro - needs execution) · `ABSENCE` (claim of missing thing - carries declared scope). No untagged claims.
- **R5 - The falsifier gate.** For every `BLOCK`/high finding, write the one artifact that would *refute* it and confirm you opened it. If you have not opened the falsifier, the finding is downgraded to `unverified - pending <artifact>`. No exceptions.

If you catch yourself about to write a severity word next to a sentence you cannot point at an artifact for - stop. That is the failure this skill prevents.

> **The grounding loop mirrors `aiv svp`.** The protocol's Sovereign Verification Protocol
> (`aiv.svp_cmd`, default `aiv svp`) runs **probe → trace → falsify**. This skill's grounding work is
> the same shape: *probe* the artifacts (Phase 0 census), *trace* each claim to its evidence (Phase
> 3), and *falsify* every high finding (R5 / Phase 4). Where a project has the SVP sub-app wired, you
> may drive that loop via `aiv svp` and read its output rather than reconstructing it by hand; the
> rules above are the same discipline either way.

---

## Phase 0 - Probe: artifact census (BEFORE any judgment)

Pull and *read* every source. Produce a **Sources-Checked Manifest** (template at the end). Nothing is "absent" until it is on this manifest as checked. Do not form a single finding until Phase 0 is complete.

```bash
R=<owner/repo>; N=<pr-number>
# Metadata, body, author, merger, mergeability, state
gh pr view $N --repo $R --json number,title,state,author,mergedBy,mergedAt,baseRefName,headRefOid,additions,deletions,changedFiles,body,reviewDecision
# Commit trail WITH timestamps (you need ordering for review→fix→merge)
gh pr view $N --repo $R --json commits --jq '.commits[] | "\(.committedDate)  \(.oid[0:9])  \(.messageHeadline)"'
# THREE distinct review surfaces - query ALL THREE (R3):
gh api repos/$R/pulls/$N/reviews  --jq '.[] | "[\(.state)] \(.user.login) @ \(.submitted_at)\n\(.body)"'   # formal reviews
gh api repos/$R/pulls/$N/comments --jq '.[] | "@\(.user.login) \(.path):\(.line)\n\(.body)"'                  # inline review comments
gh api repos/$R/issues/$N/comments --jq '.[] | "@\(.user.login) @ \(.created_at)\n\(.body)"'                  # conversation comments
# CI / checks (state of execution evidence at head)
gh pr checks $N --repo $R
gh pr view $N --repo $R --json statusCheckRollup
# Linked intent (issues/RFCs the PR claims to satisfy)
gh pr view $N --repo $R --json closingIssuesReferences,body   # then read the referenced issues
# The diff - read EVERY changed file, not a skim. For large diffs, clone shallow and read locally.
gh pr diff $N --repo $R > /tmp/pr-$N.patch
```

For non-trivial diffs, **clone shallow** (`git clone --depth 1 <url> /tmp/<slug>`) so you can read full file context, resolve symbols, and - for `NEEDS-EXECUTION` findings - actually run the suite or write a repro.

Build the **review→fix→merge timeline** explicitly: sort commits by timestamp against review timestamps. Fixes that postdate a review are evidence the review was substantive and acted on - and you must credit them, not present their results as if the author produced them unprompted.

## Phase 1 - Classification (scrutinize hardest; it cascades)

Read the risk-tier definitions from the spec at `aiv.spec_path` and assign exactly one R-tier. If uncertain, classify higher (the spec's tie-break rule). The general shape (confirm against the spec, which is authoritative):

| Tier | When | SoD required |
|---|---|---|
| **R0** | docs/comments/formatting; no runtime effect | self |
| **R1** | isolated logic, bounded blast radius, full test coverage | self |
| **R2** | broad refactor, dep change, public API, DB migration, config | **independent** |
| **R3** | touches a **critical surface** OR org-wide blast radius | **independent** |

**Critical surfaces → mandatory top tier.** Do NOT carry a hardcoded list here. Read the spec at `aiv.spec_path` and use **its** enumerated critical-surface list (the section is mapped under `review.spec_sections` if the project configured it). File a critical-surface finding (e.g. `<surface-section>-F1`) if the PR touches any surface the spec names but was classified below the tier the spec requires for it. Typical surfaces a spec enumerates: authentication/authorization, cryptography/secrets/credential handling, payments/financial, PII/PHI, audit logging / data-of-record integrity, access control. A *production database that is a system of record* is audit-data integrity and classifies to the top tier - but defer to the spec's exact wording, not this gloss.

Then record **required evidence classes** for the tier and the **required SoD**, and check the *actual* SoD against Phase 0 facts (author identity vs reviewer/verifier identity - NOT vs who clicked merge). File the SoD finding only if no independent verifier of a different identity reviewed before merge - and only after R3's three review surfaces were all checked.

## Phase 2 - Claim extraction

List the PR's **load-bearing promises** - the things that, if false, make the change unsafe. ("Idempotent re-sync," "no data loss," "atomic swap," "backward compatible," "rejects expired tokens with 401.") These are what you grade. The PR body is where authors state them; the *risk* is in the ones they imply but don't state.

## Phase 3 - Trace: evidence grounding (per claim)

For each claim, find the artifact and tag it (R4):

- **VERIFIED** - a positive artifact you read or ran supports it: a passing test that exercises the symbol, a CI run at `head_sha`, a resolved SHA-pinned permalink, a diff hunk. Prefer **executed** evidence; a test that *exists* is not a test that *passed* - cite the run, or run it.
- **CODE-READ** - you reasoned from source; no repro. Legitimate and valuable, but it is a hypothesis until executed. These become your "needs execution" list.
- **ABSENCE** - the claim has no covering evidence (e.g., "measurement-level idempotency is untested"). Must name the scope searched (which tests/files/CI you checked).

Map the AIV **evidence-class scorecard** (what the tier required vs what exists). Tier requirements come from the spec - the table below is the general shape; defer to `aiv.spec_path`:

| Class | Proves | Required | What counts |
|---|---|---|---|
| **A** Execution | tests passed in a defined env | all tiers | CI run URL at head_sha, or pasted pass/fail/skip counts. *Authored ≠ executed.* |
| **B** Referential | claims trace to exact code | all tiers | SHA-pinned permalinks w/ line anchors |
| **C** Negative | absence of disallowed patterns | R2+ | declared-scope search: no deleted asserts, no skip markers, regression-suite green |
| **D** Differential | change impact beyond tests | R3 (○R2) | API/state/config before-after; an UNTOUCHED blast-radius list |
| **E** Intent | alignment w/ upstream req | R1+ | immutable (SHA-pinned) link to issue/RFC/spec |
| **F** Provenance | integrity / chain-of-custody / rollback | R3 (○R2) | sha256 manifest, signed commits, OR a real rollback artifact (e.g. backup-before-overwrite) |
| **G** Cognitive | human predicted behavior before reading | optional | prediction *timestamped before* code review (the `aiv svp` prediction step produces this). **Never fabricate post-hoc - omission is correct, faking is gaming.** |

A non-AIV PR will not label these; you map its actual artifacts onto the grid and report the gaps as what AIV *would* require - not as if packets were expected. Where an AIV packet exists, validate its shape through the tool rather than by eye: `<aiv.cli> check <packet>` (default `aiv check`); this skill grades whether the evidence is *real*.

## Phase 4 - Falsify: adversarial self-audit (HARD STOP - do not skip)

Before writing output, run R5 against every `BLOCK`/high finding and every `ABSENCE` claim:

1. **Falsifier:** name the single artifact that would refute this finding.
2. **Opened?** Did Phase 0 actually pull and read it? If not → downgrade to `unverified - pending <artifact>`, or go pull it now.
3. **Severity vs grounding (R1):** is this BLOCK backed by a read/run artifact, or only by reasoning? If only reasoning → recap to `NEEDS-EXECUTION`.
4. **Absence scope (R2):** does every "no X" name its sources? If not → add scope or delete the claim.

Write the falsifier check into the audit (a one-line "refuted by: <artifact>; checked: yes/no" per high finding). This is what makes the audit auditable and is the structural fix for fabricated findings. Where the SVP sub-app is wired, `aiv svp` (default `aiv.svp_cmd`) drives this same falsification step.

## Phase 5 - Output

Post/return a single structured artifact:

1. **Classification** - R-tier + rationale + which spec critical-surfaces apply + required vs actual SoD.
2. **Verdict** - was verification adequate for the risk? One honest sentence.
3. **Findings** - spec-finding-ID form (`<surface-section>-F1`, `A-F1`, `E-F1b`, plus `H1/H2…` for correctness), each with **severity + grounding tag + falsifier line**.
4. **Evidence-class scorecard** - the A-G table: required / present / gap.
5. **Needs-execution list** - every `CODE-READ` finding, with an offer to run the repro and convert it to `VERIFIED`.
6. **Sources-Checked Manifest** (below) - appended so the audit can be audited.

State the **honest boundary** every time: you are not the human independent verifier; you can hallucinate; `NEEDS-EXECUTION` findings are run or flagged, never assumed; the human is the final independent verifier.

---

## Sources-Checked Manifest (instantiate per PR)

Write to the configured audit output dir (`audit.out_dir`, default `.aiv/audits/`) as `rigor-audit-pr<N>.md`.

```
## Sources-Checked Manifest - <repo> PR #<N>   (auditor: <id>, <date>)
- [ ] PR metadata + body                 → <read? key facts>
- [ ] Commit trail w/ timestamps         → <N commits; range>
- [ ] Full diff, every file              → <files read / total>
- [ ] Shallow clone + suite runnable?    → <yes/no; path>
- [ ] pulls/N/reviews (formal)           → <count + states, or "empty (≠ no review)">
- [ ] pulls/N/comments (inline)          → <count>
- [ ] issues/N/comments (conversation)   → <count + who/when>   <-- R3: the one that bites
- [ ] gh pr checks + statusCheckRollup   → <ran? green? or "none reported">
- [ ] Linked issues / RFC (intent)       → <resolved? SHA-pinned?>
- [ ] review→fix→merge timeline built    → <reviewer, fix commits, merger, ordering>
- [ ] Author identity vs verifier identity → <same? different? → SoD verdict>
```

A finding that asserts the absence of anything not covered by a checked box on this manifest is malformed (R2).

---

## Failure modes this skill encodes (do not repeat)

These are protocol-neutral lessons; they hold on any repo, AIV-enabled or not.

- **The empty-field fallacy.** A formal-reviews field came back empty and was read as "no review" - while the review actually sat in the conversation-comment surface. The contradicting signal (a non-zero comment count) was in-hand and unread, producing a fabricated BLOCK finding. The lesson: an empty structured field is one surface, never the conclusion; query every surface a review can hide in before any "no review" claim. → R3, R5, and the manifest exist to make this impossible.
- **Crediting outcomes, not loops.** Presenting review-driven fixes (cleanup, gating, tests) as if the author produced them unprompted. → Phase 0 timeline + "credit the review."
- **Authored-as-executed.** Treating an authored test as passing Class A evidence. → cite the run or run it.
- **Validator drift.** Confirming a claim by repeating the PR's own numbers. → R4 tags + Phase 3 demands an independent artifact, not the claim restated.

## Multi-PR runs

When auditing a set (e.g., several PRs staking firm reputation): instantiate one manifest per PR, run all five phases identically per PR, and keep verdicts independent. Report a portfolio summary only after each PR's manifest is complete. Apply the same severity/grounding bar to all - consistency across the set is itself part of the rigor.
