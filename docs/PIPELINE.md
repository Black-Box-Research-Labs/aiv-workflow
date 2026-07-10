# The AIV pipeline: audit finding to merge

The blueprint aiv-workflow implements. It drives a project from an **audit finding** to a **merged
PR** with exactly two human touchpoints. Everything between is automated agents calling skills; the
[`aiv` CLI](https://github.com/Black-Box-Research-Labs/aiv-protocol) (Layer 1) handles all substrate
operations (packet scaffolding, evidence collection, validation, the guard).

## The premise

Two human touchpoints, no more:

- **H1 - the audit.** A human produces findings, each with evidence (line numbers, a cited SHA, an
  artifact). A finding is a unit of work with a falsifiable anchor.
- **H2 - the evidence judge.** A human judges the AIV evidence at the end and performs any
  irreducible human verification.

The entire design exists to make H2's job pure *judgment* ("is this evidence good?") rather than
*verification* ("does this actually work?"), by forcing the agents to prove that themselves.

## Master flow

```
H1  AUDIT -> finding {evidence: line#, cited SHA, artifact}            [HUMAN #1]
      |
  +---v----------------- PLAN PHASE  (agent | full context) ------------------+
  |  launch-brief  -> brief + completion-contract  (finding -> dispatch)       |
  |       |                                                                    |
  |  plan mode     -> THE PLAN  (atomic commits, TDD cycle, test layers,       |
  |       |            scope boundaries, untouched files) = primes the agent   |
  |  check-drift  <--loop-->  revise plan      [CONVERGENCE GATE #1 - the PLAN]|
  +-------|--------------------------------------------------------------------+
          |  plan converged -> exit plan mode
  +-------v------------- BUILD PHASE  (agent | full context) -----------------+
  |  start-pr   -> worktree + (aiv init if needed) + invokes ground-yourself  |
  |  design-tests -> bug catalog + tests (each names the bug it catches)      |
  |  WRITE CODE per plan -- per atomic commit: aiv-packet (1 file + 1 packet, |
  |       |   TDD red->green->refactor          enforced by the aiv hook)     |
  |  prove-it   -> behavioral artifacts (render / e2e / cited-baseline),      |
  |       |          bound to AIV classes; per-claim PASS|UNVERIFIED [SEAM]    |
  |  local-CI replica -> push -> open PR                                       |
  +-------|--------------------------------------------------------------------+
          | ===== CONTEXT BOUNDARY (SoD) | impl reasoning does NOT cross =====
  +-------v------------- REVIEW PHASE  (independent | isolated) --------------+
  |  CI gates (tests / aiv guard / coverage / lint)                           |
  |  or-review (multi-angle + verify) + aiv-audit (packet content + harvest)  |
  |       |   [+ rigor-audit when reputation/external]  -> ONE PR comment      |
  +-------|--------------------------------------------------------------------+
          |
  impl agent -- poll-ci -> reads review verdict + CR body + human notes        |
          |   addresses findings (loops back to build / prove-it) -> push      |
          |   re-fire review (round++)            [CONVERGENCE GATE #2 - impl]  |
          |   terminate when: contract OK + classes present & non-vacuous +    |
          |                   CI green + verdict PASS + 0 UNVERIFIED, N rounds  |
          |
  H2  JUDGE -> AIV evidence level + irreducible human verification    [HUMAN #2]
          |     (the system's single independent verifier; scrutiny by R-tier)
          |  confirm
  merge  -> rebase + delete branch -> post-merge bookkeeping
```

## Stage by stage

| # | Stage | Actor | Skill(s) | Gate / exit |
|---|---|---|---|---|
| 0 | Audit -> findings | Human (H1) | (manual) | a finding with a falsifiable evidence anchor |
| 1 | Finding -> dispatch | Agent | `launch-brief` | brief + contract; finding evidence becomes acceptance |
| 2 | Plan authoring | Agent | (plan mode) | a systematic, comprehensive plan exists |
| 3 | Plan convergence | Agent | `check-drift` (+ fan-out) | **GATE #1**: structural + quality + graph OK, no hard stops |
| 4 | Build pre-flight | Agent | `start-pr` -> `ground-yourself` | isolated worktree, project AIV-enabled, grounding has no gaps |
| 5 | Test design | Agent | `design-tests` | each test names its bug; investigation pass run |
| 6 | Write code | Agent | (follow the plan) + `aiv-packet` per commit | aiv hook 1+1 per commit; TDD green |
| 7 | Prove it works | Agent | `prove-it` | **SEAM GATE**: 0 UNVERIFIED behavioral claims cross to review |
| 8 | Push | Agent | (built-in verify/run) | local-CI replica clean first |
| 9 | CI gates | Automated | tests / aiv guard / coverage | all required green |
| 10 | Independent review | Review entity (isolated) | `or-review` + `aiv-audit` [+ `rigor-audit`] | **GATE #2** (one round): PASS / WARN / FAIL |
| 11 | Address + loop | Impl agent | `poll-ci` | loops back to 6/7 per finding; round auto-increments |
| 12 | Convergence terminator | (rule) | - | contract + classes + CI + PASS + 0 UNVERIFIED, stable N rounds |
| 13 | Final judge | Human (H2) | (manual) | judges evidence + irreducible human verification |
| 14 | Merge | Agent (gated) | (no autonomous merge) | H2 confirm; rebase + delete branch; post-merge bookkeeping |

## The two convergence loops (the spine)

The architecture is not a line. It is **two verification loops bracketing the cheap coding step.**

- **Loop #1 - converge the PLAN (`check-drift`).** An independent signal on the plan *before* any
  code. Loops audit -> revise -> re-audit until structural integrity, plan-quality, and plan-graph
  checks pass with no hard stops. This is why there is no "write the code" skill: the plan is made
  good enough that execution is mechanical.
- **Loop #2 - converge the IMPLEMENTATION (review + `poll-ci`).** An independent signal on the PR.
  The isolated review entity posts a verdict; the impl agent polls, addresses findings, pushes, and
  re-triggers review with an incremented round. Loops until the terminator condition holds.

They mirror each other deliberately: one brackets the front of the cheap part, one the back.

## The two hard invariants

1. **Context isolation at the build->review boundary (separation of duties).** The review entity
   receives the PR + the spec + the evidence artifacts, never the implementer's reasoning. The build
   agent cannot talk the reviewer into a PASS because the reviewer never hears its story. When both
   author and verifier are agents (the spec holds that an AI is not a second person), every PR is
   effectively self-verified until H2. **H2 is the system's single independent verifier**; the
   R-tier scales how hard H2 scrutinizes a uniform packet.

2. **The evidence chain is preserved end to end.** The evidence that starts the pipeline threads
   through every stage and is never broken:

   ```
   finding (line#, cited SHA)
      -> launch-brief acceptance criteria
      -> plan verified-state
      -> aiv-packet  Class E (intent = the finding, immutable) + Class B (referential, line-anchored)
      -> prove-it    cited-baseline diff (before/after vs the EXACT ref the finding pins)
      -> aiv-audit   verifies claim<->evidence correspondence against that same chain
      -> H2 judges the chain
   ```

   Nothing is asserted that is not anchored to the finding's original evidence. That is what makes a
   claim defensible months later.

## Relationship to aiv-protocol

Layer 2 (these skills) calls Layer 1 (the `aiv` CLI) for every substrate operation:

- `start-pr` runs `aiv.init_cmd` when a project is not yet AIV-enabled.
- `aiv-packet` / `aiv-audit` scaffold and validate packets through the CLI instead of hardcoding the
  spec's header/class rules.
- `prove-it` feeds its Class A/D behavioral artifacts into the evidence collector.
- `or-review` / `rigor-audit` align to the protocol's SVP phases (probe / trace / falsify) rather
  than inventing parallel ones.

## The orchestration layer (built)

This section originally listed three things "not yet built" on the road to full automation. All
three now exist in [`orchestration/`](../orchestration/README.md) (`src/fix_pipeline.mjs`; operating
manual in [`MAINTAINER_GUIDE.md`](MAINTAINER_GUIDE.md)):

1. **Convergence terminator (Stage 12)** — now an objective rule: the back-half loop terminates when
   the completion contract is verified, all evidence classes are present and non-vacuous, CI is
   green, and the review verdict is PASS — stable for N rounds at the same head. Conflicting gates
   two rounds running are an oscillation HALT, never a silent pass.
2. **Gate enforcement of the all-class mandate** — enforced harness-side: the packet gates assert
   every Class A-F section exists (honest N/A rationales allowed) before a stage may pass.
   Enforcement inside aiv-protocol's own guard (guard flags + N/A short-circuit) remains open.
3. **The orchestration layer** — `fix_pipeline.mjs` drives stages 1->14 unattended: each stage is a
   fresh isolated subagent, every transition gates on a schema-valid machine block, and failures
   HALT fail-closed. The two human touchpoints stand: H1 (the finding) in, H2 (judge + merge) out.
