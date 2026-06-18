---
name: aiv-packet
description: Design an AIV verification packet for an atomic commit without producing verification theater. Use when preparing a commit in an AIV-enabled repo whose pre-commit hook enforces the atomic-commit policy (1 functional file + 1 verification packet per commit), or when the user asks for an "AIV packet" / "verification packet" / references the AIV spec. Walks classification, claim design, evidence harvest, and packet drafting in that order. Distinct from the behavioral-evidence engine that captures runtime artifacts (this skill FORMATS what that engine captured) and from packet-shape validation (which the `aiv` CLI does). Output: a markdown packet under the configured packets dir plus a list of which files belong in the atomic unit and how to stage them.
---

# AIV Packet Design

A verification packet earns its keep only if it would **make a false claim detectable by an outside auditor**. A green-CI badge stapled under "Class A" with no test counts, a Class B that links to a file path instead of a line range, a Class E that points at "the diff" - these are verification theater. The AIV spec calls them out by name (see the *Verification Theater* section of `aiv.spec_path`).

This skill produces packets that survive an honest reread. The four-phase process forces falsifiability before drafting.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override
> via `$AIV_WORKFLOW_CONFIG`). Keys used: `aiv.cli` (default `aiv`), `aiv.packets_dir` (default
> `.github/aiv-packets`), `aiv.evidence_dir` (default `.github/aiv-packets/evidence`),
> `aiv.check_cmd` (default `aiv check`), `aiv.spec_path` (default `aiv-protocol/SPECIFICATION.md`),
> `evidence.mandate_all_classes` (default `true`), `evidence.exclude_classes` (default `[G]`),
> `evidence.na_requires_rationale` (default `true`), `ci.test_cmd`. If the file is absent, use these
> defaults and say so.

## The bar - every packet must clear all five

1. **Risk tier walked, not vibed.** Classification rationale cites the spec's tier criteria explicitly (critical-surface / blast-radius / tier-definition sections of `aiv.spec_path`), not vibes.
2. **Claims are falsifiable property statements**, not activity statements ("the system has property X", not "I added X").
3. **Each claim states its falsification criterion** ("falsifiable by: emitted JSON whose `findingKind` is missing").
4. **Class A test results have pass/fail/skip counts and an enumerated test list**, not "tests pass".
5. **Pre-existing failures are isolated from change-caused failures** via stash-and-rerun, with both states recorded.

If a packet fails any of the five, redraft. See [ANTIPATTERNS.md](ANTIPATTERNS.md).

## Process

### Phase A - Classify (deliberate, criteria-walked)

Before reading the diff a second time, write down the **logical unit of work**: the coordinated change that may span multiple files and multiple atomic commits but shares one packet. Then walk the spec (`aiv.spec_path`):

1. **Critical surfaces.** Does the change touch auth, crypto, secrets, payments, PII, privilege boundaries, or audit/logging? If yes → highest tier (R3), regardless of size.
2. **Blast radius.** Local (single fn/module, no callers outside file) → R0-R1. Component (multiple files, single service) → R1-R2. Service / cross-service / organization → R2-R3.
3. **Tier definitions.** R0 = docs/comments/formatting only, no runtime effect. R1 = isolated logic, bounded blast radius, comprehensive tests. R2 = broad refactors, deps, public API, config, schema migrations. R3 = critical surfaces or org-wide blast radius.
4. **Tie-breaker rules** (decision-time):
   - **Schema-conformance fix vs schema change.** Bringing code into compliance with an already-authoritative contract = R1. Changing the contract itself = R2 minimum.
   - **Additive flag with a default that preserves old behavior** = R1. Removing or changing a flag's semantics = R2 minimum.
   - **New file with no callers yet** = R0 if pure docs, R1 if logic. Becomes R2 the moment a caller is wired up.
   - **Uncertain between two tiers** → take the higher one (the spec mandates rounding up).

Then write the classification block:

```yaml
classification:
  risk_tier: R0 | R1 | R2 | R3
  sod_mode: S0 | S1
  critical_surfaces: []          # REQUIRED for R3; list surfaces touched
  blast_radius: local | component | service | cross-service | organization
  classification_rationale: >
    [Plain-English why this tier and not the adjacent tiers. Must reference the
    spec's tier criteria, not vibes. If R2/R3, justify the escalation. If R0/R1,
    rebut why the higher tier doesn't apply.]
  classified_by: "<author-id> (Author) + <verifier-id> (Verifier)"
  classified_at: <ISO-8601>
```

**SoD assignment rule:** the directing human is the Author; the AI agent is the Verifier. At R0/R1 (S0 self-verify) the same human can sign both roles via different identities (human + AI). At **R2+ (S1)** the spec strictly requires two different natural persons - the AI agent does NOT count as a second person.

**Two paths at R2+ in solo + AI workflows:**

1. **Spec-strict (full conformance):** halt and escalate to a human verifier. Don't proceed without S1.
2. **Codebase-pragmatic (transitional conformance with a documented waiver):** if the host codebase has an established convention of solo-AI verification at R2 (visible in existing R2-classified packets that name the AI agent as Verifier), document the SoD non-conformance in the packet header per the spec's exception section and proceed with S0. Future merge-time enforcement (a CI gate requiring a second-human verifier_id) is the maturity path.

Path (2) is what most real-world solo developers use; path (1) is the spec ideal. The skill writes path (2) by default *unless the user has explicitly requested strict conformance*. The waiver text in the packet header should reference the existing R2-classified packets that establish the convention, so an auditor can see the pattern is not a one-off.

**Heuristic for "has the convention been established here?":** grep the packets dir for prior solo-verify / self-verify / waiver phrasing - if any prior packet uses these at R2+, the convention is documented and you can follow it:

```bash
grep -l "self-verify (S0)\|S0 (Self-Verify)\|solo-verify\|waiver\|Exception" "$(<aiv.packets_dir>)"/*.md
```

### Phase B - Design claims and required evidence (deliberate, before harvest)

For each falsifiable property the change establishes, write:

- A **CLM-NNN** numbered statement of the property.
- Its **falsification criterion**: what observation would prove the claim wrong.
- The **evidence class(es)** that would establish or refute it.
- Which **artifact reference** (file:line, test name, commit SHA) carries the evidence.

**All-class mandate (address-all, honest N/A).** When `evidence.mandate_all_classes` is true, **every packet addresses all of A-F** regardless of tier. There is no per-tier evidence *floor* that decides which classes appear: the closed automated pipeline whose only human touchpoints are the initial audit and the final evidence judge no longer rations *human verifier* effort, so the tiered floor that justified omitting classes is gone. For a class that genuinely does not apply, emit a one-line **falsifiable N/A rationale** - never an empty section, never vacuous filler (that manufactures the exact theater this skill exists to kill). When `evidence.na_requires_rationale` is true, a present-but-vacuous class section fails the same falsifiability bar as a missing one.

| Class | Disposition | What an honest N/A looks like |
|---|---|---|
| **A** Execution | always real | (never N/A - every change runs something) |
| **B** Referential | always real | (never N/A - claims always trace to code) |
| **C** Negative | address | "no disallowed-pattern surface in this change - C N/A; scope searched: `<paths>`" |
| **D** Differential | address | "no runtime/output surface (docs-only) - differential N/A" |
| **E** Intent | always real | "intent = finding `<ref>`, immutable at SHA `<x>`" |
| **F** Provenance | address | "full provenance pending signing infra - sha256 manifest supplied" |
| **G** Cognitive | **EXCLUDED** (`evidence.exclude_classes`, default `[G]`) | omit; automating a before-reading prediction is gaming. Re-enters only when the operator's scalability work lands. |

**The risk tier no longer gates which classes APPEAR.** It now gates two other things: (1) which class *content rules* the validator fires (`aiv.check_cmd` still applies the stricter C/E/B-line-anchor rules at higher tiers), and (2) the human judge's scrutiny budget at the end (high-R → judged hard; low-R → skimmed over a uniform packet). The **behavioral** artifacts for Class A and D are captured by the `prove-it` evidence engine BEFORE you draft - `prove-it` runs the composed system, captures screenshots / traces / before-after dumps, and hashes them; **this skill *formats* what that engine captured, it does not re-run the app.** Run `prove-it` first, then drop its paste-ready blocks into the sections below.

**Class quality requirements (the parts most often skipped) - see the per-class sections of `aiv.spec_path` for the normative rules:**

- **Class A (Execution):** CI run reference immutable to `commit_sha`; pass/fail/skip counts; **enumerated test list** (not "tests pass"); static analysis result; OS + runtime version. Missing counts is a BLOCK finding.
- **Class B (Referential):** SHA-pinned permalinks with **line anchors at R2+** (BLOCK at R2+); each claim must map to ≥1 evidence item (BLOCK).
- **Class C (Negative):** at R2+, simple grep is **explicitly insufficient** (BLOCK). Negative evidence requires AST-based diff, coverage-tool comparison, or framework JSON output - structurally aware, deterministic, machine-readable.
- **Class E (Intent):** intent reference must be immutable. Acceptable: SHA-pinned commit, versioned issue ID, snapshot+hash. Not acceptable: branch link, or mutable issue URL without a snapshot-obligation block under the transitional pathway.
- **Class G (Cognitive):** post-hoc prediction is gaming. If you didn't write the black-box prediction *before* reviewing the implementation, **omit Class G** (it is excluded by default via `evidence.exclude_classes`) and say so in known limitations. Don't fabricate.

**Phase B output format:**

| CLM | Property | Falsification | Class refs |
|---|---|---|---|
| CLM-001 | [property the system has] | [observation that would refute] | A-1, B-1 |

### Phase C - Harvest evidence (only what's needed for Phase B)

Run only the commands that produce artifacts named in Phase B's class refs. Capture output to canonical form (API exports, framework JSON, line-anchored permalinks - **never scraped HTML**; the spec's canonical-form section is normative).

**Evidence-harvest hygiene checklist:**

- [ ] **Run-against-HEAD comparison.** For each test you cite as Class A, also run it with `git stash push <test-file>` to isolate "fails because of me" from "already failing on the branch." Record both states. Without this isolation, "tests pass" claims are theater when other tests in the same suite were silently failing pre-existing.
- [ ] **Typecheck scope hygiene.** A repo-wide typecheck includes errors from sibling unstaged work. Either stash unrelated work, or run the typechecker scoped (e.g. `npx tsc --noEmit`) and grep for errors specifically in this unit's files. State the scope used in Class A.
- [ ] **Mirror existing fixtures.** When extending a test file, copy a working fixture pattern from the same file. Inventing a fixture from memory of "what the parser probably wants" is the dominant failure mode for new test code. If a fixture fails, find a working sibling first.
- [ ] **Test gaps: fix immediately, don't defer.** If Phase B reveals a code path with no test, write the test in this unit. Don't claim "comprehensive coverage" without the test, and don't kick the gap to a follow-up - it's tech debt.
- [ ] **Per-claim links, not blanket links.** Each CLM gets its own `path:line-line` reference. A single permalink at the bottom doesn't satisfy the per-claim referential rule.

### Phase D - Draft the packet

File location: under `aiv.packets_dir` (default `.github/aiv-packets`), named `VERIFICATION_PACKET_<TASK_ID>.md`.

Required sections (in this order):

1. **Header**: title naming the file or unit being verified; Author / Verifier line.
2. **§0. Logical Unit of Work**: which files, which atomic commits share this packet, cross-references to related packets.
3. **§1. Classification**: the YAML block from Phase A.
4. **§2. Claims**: numbered CLM-NNN, each with falsification criterion.
5. **§3. Evidence** (literal H2 `## Evidence`): one `### Class X` subsection for **every class A-F**, in canonical order **E → B → A → C → D → F**. Per-claim, not blanket. A class that does not apply still gets its `### Class X (…)` heading with the one-line N/A rationale from the all-class table as its body - the heading stays present so the packet is uniform for the judge.
6. **§4. Known Limitations**: deferred work, scope decisions, pre-existing issues observed but out-of-scope. **This section is load-bearing** - the difference between an honest packet and a polished one is whether known limitations are stated.
7. **§5. Verification Methodology**: commands to reproduce evidence (the verifier inspects artifacts; commands are context only).
8. **§6. Summary**: one paragraph. What changed, what tier, where the load-bearing evidence lives.

**Validate the shape with the tool, not by eye.** Do not restate the validator's literal header strings or rule IDs as skill knowledge - run the validator and read its output:

```bash
<aiv.cli> check <packet>     # configured aiv.check_cmd (default: aiv check); add --diff / --strict / --audit-links as needed
```

`aiv check` is THE validator (there is no separate `guard` CLI). It confirms the packet's *shape* - required headers, class presence, line anchors at the right tier. Your job in this skill is that the evidence is *real*; let the tool confirm the structure. The `§N.` numbers above are logical labels for your benefit; type the literal headers the validator expects and let it tell you if you missed one.

**Progressive workflow:** at commit-time, markdown-only is fine. Commit-SHA placeholders are allowed and replaced with real SHAs at PR-time. CI run links can be placeholders pre-push, tightened post-CI.

### Stage and commit

The pre-commit hook (installed by `<aiv.cli> init` from aiv-protocol) enforces atomicity: roughly **1 functional file + 1 packet per commit**. **Read [HOOK-RULES.md](HOOK-RULES.md) before staging.** Common patterns:

- **First commit of the unit:** stage the one functional file + the packet (the canonical atomic unit).
- **Subsequent commits sharing the same packet:** stage the next functional file + the packet (touch a CLM "satisfied at commit X" line so the packet diff is real).
- **Test files with hunks belonging to multiple units:** use `git add -p` to split. Mirror the unit boundary; never bundle.
- **Dependency manifest + lockfile:** the hook allows these to commit together as a pair with no packet.
- **Data / non-functional files:** commit one file per commit, no packet needed (they are not "functional" to the hook).

If the hook rejects: read the rejection message, identify which rule fired, fix the staging set. **Never** `--no-verify`. Never amend a hook-rejected commit (the commit didn't happen; amending modifies the previous commit).

## Antipatterns to avoid

See [ANTIPATTERNS.md](ANTIPATTERNS.md) for the catalog. The most common in practice:

1. **"Tests pass" without counts.** Class A blocked on missing counts.
2. **Future-commit evidence as current-commit evidence.** "Test X covers this" when X is added two commits later.
3. **R1 by vibe when it's actually R2.** Schema-change disguised as schema-conformance, public API change disguised as additive flag.
4. **Class G with post-hoc prediction.** Gaming; omit instead (it is excluded by default).
5. **Comprehensive coverage claim without checking.** State which paths are covered and which aren't (limitation entry if any aren't).
6. **Pre-existing failures absorbed into the unit's claims.** A failure that reproduces with `git stash` is not yours; record it as a known limitation, don't silently inherit it.
7. **Pre-populated SHA-log table in the seed packet.** Defeats the atomic-unit rule on every subsequent functional commit because the packet then has no per-commit diff. Leave the table empty in the seed and append per-commit.
8. **Retroactively committing a stale orphan packet.** A packet describing already-shipped work that never had a commit at the time. Delete and replace with a packet for current work; don't let the audit trail imply a process that didn't happen.
9. **Vacuous all-class filler.** The all-class mandate means *address* every class, not *fake* it. A `### Class D` that says "differential analysis performed" with no before/after artifact, or a `### Class C` that says "checked for issues" with no declared scope, is worse than an honest `N/A - docs-only, no runtime surface`. Present-but-vacuous fails the same falsifiability bar as a missing section; the N/A rationale must itself be falsifiable.

## The seam with the rest of the loop

- **`prove-it` feeds this.** It is the evidence ENGINE: it runs the composed system and captures the behavioral Class A / Class D artifacts (screenshots, traces, before/after dumps) under `aiv.evidence_dir`, with a `sha256` manifest. This skill is the FORMATTER: it drops those artifacts into the packet's class sections and writes the falsifiable claims around them. Run `prove-it` first.
- **The validator confirms shape; you confirm substance.** `aiv check` is mechanical - it counts sections and matches headers. An auditor reads the content. If your packet would pass the validator but make an auditor wince, you optimized for the wrong objective.
- **The review entity reads the packet cold.** Context isolation is the point: the reviewer gets the diff + the packet + the evidence artifacts, not your reasoning. Write the packet so it stands alone.

## Principles this skill enforces (universal, not project-specific)

- "Looks perfect" usually means a missing measurement dimension. If a reread comes back clean too easily, add the dimension that would have caught a fabricated claim, then re-read.
- A PASS-shaped packet is a *readiness* signal, not merge authority. The human is the final evidence judge and the merge gate.
- The atomic-commit hook is the floor, not the ceiling: it counts files and matches regexes; the packet must survive an auditor who reads the content.

## When to invoke this skill

- User says "AIV packet", "verification packet", "AIV protocol", "AIV spec".
- User is in an AIV-enabled repo whose pre-commit hook enforces atomic commits and asks for help committing.
- User asks "what packet should this commit have" or "how do I get this past the hook".
- User mentions Risk Tier R0/R1/R2/R3, Class A-G evidence, or Sovereign AIV.

**Do not invoke** for ordinary commits in repos without the AIV hook. Most repos don't enforce this and the overhead is wasted.
