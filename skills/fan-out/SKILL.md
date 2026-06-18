---
name: fan-out
description: Launch N parallel sub-agents to investigate a question from multiple angles, then explicitly verify each claim and synthesize. Use when user says "fan out", "launch parallel agents", "parallel sub-agents", "examine the problem from multiple angles", or when a research question is broad enough that multiple angles will surface more than a single deep dive.
---

# Fan out - parallel-angle research with explicit verification

Use for questions where multiple lenses reveal more than one deep search. NOT for narrow lookups - use Explore directly for those.

> **Config (optional).** If a `.aiv-workflow.yml` exists at the repo root (`git rev-parse
> --show-toplevel`; override via `$AIV_WORKFLOW_CONFIG`), it names the project facts the angles below
> reference: the spec/design doc (`aiv.spec_path`), the project memory (`memory.dir` / `memory.index`),
> and the verification-packet dir (`aiv.packets_dir`, default `.github/aiv-packets`). If the file is
> absent, auto-detect what you can (repo root, the spec doc, a memory dir) and proceed with the
> generic angles below - this skill is research orchestration and degrades gracefully without config.

## When to use

- "How does X fit together across the codebase?"
- "What are all the gaps in Y plan?"
- "Verify the claims in this design doc against actual code"
- "What do we know about Z from spec / code / tests / memory?"

## The protocol

### 1. Decompose the question into N angles (3-7)

Each agent gets exactly one angle. Good angle decomposition uses DIFFERENT QUESTION TYPES, not just different files:

| Angle | What it does |
|---|---|
| **Spec angle** | read the project's spec / design doc (`aiv.spec_path`, or the relevant design doc) for what was promised |
| **Code angle** | grep + read actual implementation |
| **Test angle** | read test suite - what's pinned vs unpinned |
| **Memory angle** | pull relevant entries from the project memory (`memory.dir` / `memory.index`) |
| **Precedent angle** | how was this done in prior PRs (`git log`, verification packets under `aiv.packets_dir`) |
| **External angle** | upstream tool spec / library docs / RFC |

**Bad decomposition:** "Agent 1 reads file X, Agent 2 reads file Y, Agent 3 reads file Z." That's parallelization, not multi-angle research. Each angle should ask a *different question type*.

### 2. Cover all gaps, not just the obvious ones

If user gave you 4 specific gaps to research, allocate agents for those 4 PLUS at least 1 catch-all "what else is missing here that we didn't think to ask about." **This rule exists because narrow-scoping repeatedly produces blind spots: the question the operator didn't think to ask is the one that bites.**

### 3. Fire all agents in one tool-call block (parallel)

Use the Agent tool with `subagent_type=Explore` (read-only) or `Plan` (architecture). Send all N invocations in a single message so they run concurrently. Sequential firing defeats the purpose.

### 4. Verification step - explicit, not implied

**Stress-test evidence: in real usage, "verify before synthesis" gets announced but skipped.** Don't just say "verifying claims"; do this checklist:

**4a. List the claims.** After agents return, write out each main claim that will affect your next action - one line per claim, <=8 claims total. Format:
```
CLAIMS TO VERIFY:
1. [agent-A] <claim>
2. [agent-B] <claim>
3. [agent-D] <claim>
...
```

**4b. Run one direct check per claim.** For each numbered claim, do ONE concrete verification:
- Claim is "file X has function Y" -> Read X, grep for Y
- Claim is "test Z covers behavior W" -> Read Z, confirm assertion
- Claim is "spec § says A" -> Read the spec line range
- Claim is "memory entry says B" -> Read the memory file

**4c. Mark each claim with the result:**
```
1. ✓ VERIFIED - [direct evidence: 1 line]
2. ✗ FALSIFIED - [what's actually there]
3. ? UNVERIFIABLE - [why: file missing, ambiguous, out of scope]
```

**4d. If FALSIFIED or UNVERIFIABLE claims block action: stop synthesis and report the discrepancy to the user. Don't paper over it.**

This step is the load-bearing one. Skipping it lets agent hallucinations propagate into decisions.

### 5. Synthesize

Combine the verified claims into a single coherent answer for the user. Surface:
- where agents **agreed** (high confidence, multiple ✓)
- where agents **disagreed** (must reconcile - usually one ✗ falsified the other)
- gaps that NO agent could fill (mark explicitly - don't bury)
- claims that were UNVERIFIABLE (flag as such)

Report in the user's terms, not agent-output terms.

## Anti-patterns

- **Firing agents sequentially.** Use one message with N Agent tool calls.
- **Announcing verification, then skipping it.** This happens reliably under real usage. The 4a-4d checklist exists to force it through.
- **Stopping at the N angles the user named.** Always add the "what else" catch-all.
- **Reporting raw agent summaries.** Synthesize into a single answer.
- **Synthesizing from FALSIFIED claims.** If 4c marks something falsified, the synthesis can't include it as fact.
