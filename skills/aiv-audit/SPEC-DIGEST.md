# AIV SPEC DIGEST (pipeline-delivered — do NOT search the filesystem for SPECIFICATION.md)

Distilled from aiv-protocol SPECIFICATION.md (v2.x) for headless audit runs where the full spec file is not
in the worktree. This digest is authoritative for the pipeline's audits; it is OUR maintained artifact
(re-derive from the spec if the protocol changes). Sections are named by ROLE, matching the skill.

## Risk tiers (classification section)
- R0 Trivial: docs/comments/formatting only, no runtime effect. R1 Low: isolated logic, no critical
  surfaces, bounded blast radius, full test coverage. R2 Medium: broad refactors, dependency/API/schema/config
  changes. R3 High: critical surfaces (auth, payment, credentials, encryption) or org-wide blast radius.
- Uncertain classification MUST escalate to the higher tier. The packet's classification block needs a REAL
  rationale (a TODO/placeholder rationale is a blocking finding).
- TIER CALIBRATION (audit judgments): R3 is triggered ONLY by the spec's NAMED critical surfaces (auth,
  payment, credentials, encryption, PII flows) or a concretely identified organization/cross-system blast
  radius — NEVER by emphatic rationale prose ("critical", "affects all downstream X") describing scientific or
  domain importance inside one component. An isolated single-module fix with comprehensive tests is textbook R1
  no matter how important that module is to the repo's outputs. Do NOT raise a blocking tier-escalation finding
  unless you name the specific critical surface or cross-system boundary the change touches.

## Evidence classes (definitions section)
- A Execution: proves tests/checks RAN in a defined environment — verbatim tool output or CI permalink,
  never a prose assertion. AST/static cross-reference counts are NOT execution evidence (label them Class D-style
  static analysis or back them with a real run).
- B Referential: SHA-pinned, line-anchored traceability to exact code locations (`file#Lx-Ly` at a commit).
- C Negative: what was searched for and NOT found (disallowed patterns, regressions, weakened tests) — show the
  search, not just the conclusion.
- D Differential/static: change impact beyond test coverage (lint/type/build, diff-scope analysis).
- E Intent: alignment with the upstream requirement — a SHA-pinned permalink to the ORIGINAL audit/finding
  source PLUS an alignment assessment ("source records defect X; this change does Y addressing X"). A bare URL
  is intent theater; a branch-ref or mutable link violates immutability.
- F Provenance: artifact integrity + chain of custody — the claim must be BOUND in a Class F section
  ("Claim N:"), negative framing ("no pre-existing test modified/deleted") with a SHA-pinned compare/diff link.
- G Cognitive: optional everywhere; the pipeline excludes it.
- PIPELINE MANDATE (operator, 2026-06-19, supersedes the tier-conditional table for COLLECTION): every packet
  addresses ALL classes A–F regardless of tier; a genuinely-inapplicable class carries an explicit
  "### Class X / N/A — reason" section, never a silent omission.

## Pipeline packet-pair structure (audit calibration — these are DESIGNED properties, not defects)
- One walk ships TWO packets: <change>-tests (closed at the RED-test commit) and <change>-impl (closed at the
  fix commit). A tests packet is RED-BY-DESIGN at its own head: its tests MUST fail there (the bug still
  exists). A GREEN transcript in a tests packet is valid ONLY as a post-fix capture and must be labeled with
  its true capture commit; such labeling is CORRECT, never a violation of "evidence as of its own commit".
- Cross-references between the pair (impl deferring test-change provenance to the tests packet and vice versa)
  are the designed division of evidence, NOT an auditability defect. Audit the PAIR as the unit of review.

## Evidence items (structure/retention sections)
- Verbatim outputs captured from the tool/framework (or CI API exports); scraped/retyped/hand-summarized
  output is non-conforming. References resolve at pinned SHAs (`git show <sha>:<path>` must work — a ref to a
  commit that does not contain the file is a BROKEN provenance ref, blocking).
- Packets are immutable once closed; regeneration replaces, never edits history silently.

## Verifier obligations (verification-process section)
- Zero-touch: judge artifacts only; never re-run the producer's reasoning, DO re-run cheap deterministic
  checks when needed (aiv check, git show resolution, hash verification).
- Decision is COMPLIANT / NON-COMPLIANT with finding-form items (id, severity, location, expected-vs-found);
  claim↔evidence correspondence is the core question — every claim needs evidence that actually supports IT.
