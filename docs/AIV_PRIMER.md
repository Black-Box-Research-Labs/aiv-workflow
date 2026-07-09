# AIV Primer

A self-contained introduction to the **AIV protocol** — enough to read
`MAINTAINER_GUIDE.md` (in this same `docs/` directory) without prior context. This
is a *primer*, not the normative spec; where they differ, the canonical source wins.

> **Authoritative source:** the `aiv-protocol` repository
> (`Black-Box-Research-Labs/aiv-protocol`), specifically `SPECIFICATION.md` (the
> normative standard), the README, and `docs/ERROR_CODES.md`. Everything below is
> summarized from those. This primer paraphrases; the repo is canonical.

---

## 1. What AIV is, and why it exists

**AIV** — "Auditable Verification Standard for AI-Assisted Code Changes" — is a
protocol (and a Python CLI, `aiv`) for attaching **immutable, machine-checkable
evidence** to code changes, so that "someone reviewed it" is replaced by "here is
the documented evidence of what was verified, by whom, and when."

The motivating discovery is empirical and worth internalizing, because it explains
every design choice downstream. In AIV's own AI audit, an AI was:

- a **superb Hunter** — ~100% accurate at *finding* real bugs by reading code
  adversarially; and
- a **dangerous Validator** — ~40% accurate at *confirming* claims true, defaulting
  to pattern-matching ("parroted '12 models' when the code had 13"; "verified
  theater, not logic").

The audit also documented the **Hallucination Cascade**: an AI predicts a
nonexistent function, "mentally traces" it, writes a falsification scenario testing
it, and produces a perfectly valid verification session describing a reality that
does not exist — every step internally consistent, none of it real.

AIV's answer is that **an AI can hallucinate a function, but it cannot hallucinate a
Class A artifact** (a URL to a real passing CI run) or a **Class B permalink** to a
file that doesn't exist. Evidence classes force every claim to ground out in
artifacts that exist in reality, which makes fabricated approvals structurally
impossible. AIV closes the *hallucination* path; it does not claim to stop two
colluding humans (that's the Separation-of-Duties axis — accountability, not
prevention).

*(This is the direct rationale for the fix pipeline's deterministic gates and its
"deterministic lane overrides agent self-report" principle: the AI does the
hunting, the machine does the validating.)*

---

## 2. The two-layer architecture

AIV records evidence at two granularities:

- **Layer 1 — per file.** Each `aiv commit` runs real tools against one functional
  file and writes an **evidence file**, `EVIDENCE_*.md`, into `.github/aiv-evidence/`.
- **Layer 2 — per change.** `aiv close` aggregates a change's evidence files into a
  **verification packet**, `PACKET_*.md`, in `.github/aiv-packets/`, linking each
  evidence file by commit SHA.

A **packet** is the auditable record of a change and the unit a reviewer reads. In
the fix pipeline, the **PR body is a packet**.

> ⚠ **"Layer 1 / Layer 2" is overloaded across the two repos.** Here (and in the
> `aiv-protocol` README) the terms mean **evidence granularity** — per-file evidence
> (L1) vs per-change packet (L2), as above. In the **`aiv-workflow`** README the same
> terms mean **system architecture** — the protocol/tool (L1) vs the agent workflow
> (L2). Same words, different axis. When you see "Layer 2," check which repo's doc
> you're in.

---

## 3. Evidence classes (canonical)

Six classes carry the evidence; a seventh (G) is optional/cognitive.

| Class | Name | Proves | Required at |
|-------|------|--------|-------------|
| **A** | Execution | Tests passed in a defined environment (CI run link or captured output) | all tiers |
| **B** | Referential | Traceability to exact code locations — **SHA-pinned** line-range permalinks | all tiers |
| **C** | Negative | Absence of disallowed patterns (deleted assertions, `@pytest.mark.skip`, etc.) | R2+ |
| **D** | Differential | Change **impact** beyond test coverage — API-surface / state / config deltas | R3 |
| **E** | Intent | Alignment with the upstream requirement (issue / spec / directive) | R1+ |
| **F** | Provenance | Artifact integrity + git chain-of-custody of the covering test files | R3 |
| **G** | Cognitive | The SVP mental-verification phases (predict / trace / probe / ownership) | optional |

Two things people get wrong:

- **Class D is Differential, not lint.** Linting and type-checking are *not* an
  evidence class — the canonical example packet places them in a separate "Code
  Quality (Linting & Types)" section, explicitly labeled *not* Class A. (See §7:
  `fix_pipeline.mjs` diverges here.)
- **Class B/E immutability.** Code references must be **SHA-pinned**
  (`/blob/<40-char-sha>/…#Ln`); a branch URL like `/blob/main/` is rejected (error
  `E004`). An `aiv check --audit-links` pass HEAD-probes the URLs; a dead link
  (deleted file, force-pushed commit) is a blocking error (`E021`).

---

## 4. Risk tiers and Separation of Duties

The tier sets how much evidence is required and who may verify.

| Tier | Name | Verifier (SoD) | Typical changes |
|------|------|----------------|-----------------|
| **R0** | Trivial | Self (S0) | docs, comments, formatting — checks skippable |
| **R1** | Low | Self (S0) | isolated bug fixes, minor refactors |
| **R2** | Medium | **Independent** (S1) | API changes, config, dependency upgrades |
| **R3** | High | **Independent** (S1) | auth, crypto, payments, PII, audit logging |

At **R2+**, the author cannot be the sole verifier (Separation of Duties). Required
evidence classes rise with the tier (§3). The **claim-verification gate** blocks a
commit when too many claims lack test coverage: >50% unverified blocks at R1/R2;
*any* unverified claim blocks at R3; R0 has no gate. There is **no `--force`
bypass** — you either write the missing tests or (if genuinely trivial) downgrade to
R0 with a documented skip reason.

---

## 5. The `aiv` lifecycle

The CLI ceremony a change goes through:

| Command | Does |
|---------|------|
| `aiv init` | Sets up `.aiv.yml`, the evidence/packet dirs, and pre-commit/pre-push hooks |
| `aiv begin <name> [--mode pr]` | Opens a change context (`.aiv/change.json`, gitignored); relaxes the 1-file-1-packet atomic rule so a multi-commit change can accumulate |
| `aiv commit <file> …` | Commits **one** functional file while collecting evidence by running real tools (pytest → A, `git diff` → B, anti-cheat scan → C, provenance → F). You supply the *claims*; the tool collects the *proof*. |
| `aiv close` | Aggregates the change's evidence into a Layer-2 `PACKET_*.md`, validates it, commits it |
| `aiv abandon` | Discards the change context without a packet (evidence files remain) |
| `aiv status` | Shows the active change — tracked commits, files, evidence |
| `aiv check <packet>` | Validates a packet's **structure** through an 8-stage pipeline (parse → structure → links → evidence → risk-tier → zero-touch → anti-cheat → cross-reference) |
| `aiv audit [dir]` | Audits packet + evidence **content** quality (TODO remnants, missing SHAs, missing Class F for bug-fix claims, unverified-claim rates) |
| `aiv generate <name> --tier` | Scaffolds a packet template with tier-appropriate sections |

**`aiv commit` required flags:** `-m` message, `-c/--claim` (repeatable, falsifiable
claim), `-i/--intent` (Class E URL), `--requirement` (which requirement the URL
satisfies), `-r/--rationale` (why this tier), `-s/--summary`. Optional: `-t/--tier`
(default R1), `--skip-checks` (R0 only). Note `-r` is the **rationale**, and `-t` is
the tier — a common confusion.

---

## 6. Key error codes (from `aiv check`)

| Code | Meaning | Fix |
|------|---------|-----|
| `E001` | Packet parse failure | regenerate via `aiv generate`/`aiv commit` |
| `E004` | Link not SHA-pinned | replace `/blob/main/` with `/blob/<sha>/` |
| `E008` | Zero-Touch violation | remove manual steps from the reproduction instructions |
| `E010` | Bug-fix claim without Class F provenance | add a Class F provenance claim |
| `E011` | Test modified without justification | add Class F explaining why tests changed |
| `E019` | Required evidence class missing | add the class the tier requires |
| `E021` | Dead / unreachable evidence link | re-pin to a resolving SHA |

The fix pipeline treats several of these deterministically (its `#79`/`#93`/`#110`
machinery targets E001/E004/E010 specifically).

---

## 7. Where `fix_pipeline.mjs` diverges from canonical AIV

The fix pipeline is an AIV *consumer*, and it takes two deliberate liberties. Know
both:

1. **Class D relabeling (AIV-DIV-01).** The pipeline writes its **lint/type**
   evidence under a "Class D" heading (INVARIANT #9; `completePacketClasses`).
   Canonical D is **Differential** (change impact),
   and lint/type is not an AIV evidence class. The mislabel passes because
   `aiv check` validates section *structure*, not class *semantics*. Consequence:
   these packets advertise Differential evidence they don't contain. This is a
   decision to make (relabel vs. document the convention), not a confirmed bug.

2. **Stricter Class E.** The protocol requires an *immutable* intent reference — a
   SHA-pinned spec permalink, a versioned issue ID, or a hashed snapshot (a mutable
   issue/branch URL is rejected, `E-001`). The pipeline **narrows** this to specifically
   a **SHA-pinned blob URL** into the original audit file that produced the finding
   (built at intake by `materializeFinding`) — intentional, so intent is immutable and
   traceable to the exact audit line.

Everything else — the packet format, the A/B/C/E/F evidence semantics, the tier
system, the `aiv begin → commit → close` lifecycle, the `E0xx` error codes — the
pipeline uses as the protocol defines them.

---

## 8. One-paragraph mental model

An AIV change is a set of atomic commits, each pairing one functional file with
machine-collected evidence (Layer 1), aggregated at close into one packet (Layer 2)
that a reviewer can validate mechanically without running anything themselves
(Zero-Touch). The evidence classes exist because an AI is a reliable bug-*hunter*
but an unreliable claim-*validator*, so every claim must ground out in an artifact
that exists in reality. The risk tier decides how much of that evidence is
mandatory and whether an independent verifier is required. That is the whole idea;
the rest is enforcement detail.

---

## Machine-checkable data

```json
{
  "schema": "aiv_primer_index@1",
  "source": "Black-Box-Research-Labs/aiv-protocol (SPECIFICATION.md, README, docs/ERROR_CODES.md)",
  "layers": { "L1": "per-file EVIDENCE_*.md (.github/aiv-evidence/)", "L2": "per-change PACKET_*.md (.github/aiv-packets/)" },
  "evidence_classes": {
    "A": "Execution — tests passed (all tiers)",
    "B": "Referential — SHA-pinned permalinks (all tiers)",
    "C": "Negative — absence of disallowed patterns (R2+)",
    "D": "Differential — change impact API/state/config (R3)",
    "E": "Intent — upstream requirement alignment (R1+)",
    "F": "Provenance — chain-of-custody (R3)",
    "G": "Cognitive — SVP phases (optional)"
  },
  "risk_tiers": { "R0": "Trivial/self", "R1": "Low/self", "R2": "Medium/independent-SoD", "R3": "High/independent-SoD+full-A-F" },
  "lifecycle": ["init", "begin", "commit", "close", "abandon", "status", "check", "audit", "generate"],
  "fix_pipeline_divergences": [
    "AIV-DIV-01: labels lint/type as Class D; canonical D is Differential (passes only because aiv check validates structure not semantics)",
    "Class E stricter: requires SHA-pinned audit-file blob URL vs the protocol's plain issue/spec URL"
  ],
  "founding_finding": "Hunter vs Validator — AI ~100% at finding bugs, ~40% at validating claims; evidence classes are the firewall"
}
```
