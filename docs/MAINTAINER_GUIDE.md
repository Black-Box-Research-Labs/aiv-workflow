# fix_pipeline.mjs — Maintainer's Guide

A working model of how the Polymath Track fix orchestrator actually behaves, for
someone who has to change it. Every structural claim carries a function name so you
can verify it against source rather than trust this document. References are by
function/symbol name, not line number; to locate one, grep the name in
`orchestration/src/fix_pipeline.mjs` — the names are stable.

> **Read this in one sitting.** The program is one file, 166 functions, no exports,
> no module boundaries. The structure lives in section-banner comments
> (`─────── name ───────`) and in ~130 numbered-learning comments (`#NN`). This
> guide is the map that file does not contain.
>
> **Reading path.** New to this project? Start at **§0** — it explains the problem
> the system solves and defines every term the rest of the guide uses. Already
> fluent in AIV and the fix pipeline? Skip to **§1**.

---

## 0. Start here (for readers new to this project)

Nothing below assumes you have seen this system before. If a term later in the
guide is unfamiliar, it is defined here.

### 0.1 What problem this whole thing solves

People increasingly want to hand routine bug-fixing to LLMs. But an LLM-authored
fix is only useful if you can *trust* it: a fix that looks right but is subtly
wrong — or that silently breaks something else — is worse than no fix, because it
costs a human the effort of catching it. This system exists to make an LLM's fix
**auditable**. It produces a pull request that arrives with machine-checked,
human-readable evidence that (a) the bug was real, (b) the fix actually eliminates
it, (c) nothing else regressed, and (d) the change traces back to the original
report. A human is involved at exactly two moments — choosing which bug to fix,
and judging the finished evidence before merging — and nowhere in between.

**The cast:**

- A **finding** is one reported bug: a location (`file:line`), a description, and a
  condition stating when it counts as fixed. Findings come from a *separate* audit
  process that reads a repository and lists them in `audit/02-static-audit.md`;
  this pipeline consumes one finding at a time (`materializeFinding`, which
  reads that file).
  You don't need that audit process to understand this one — just know a finding is
  the input.
- **Subagents** are fresh, isolated LLM instances — `claude -p`, the Claude
  command-line tool running headless (no human in the loop). Each does one job
  (write a plan, write a test, write the fix, review the result) and then goes
  away. They never share memory; see §1's "git state IS the memory."
- The **harness** is `fix_pipeline.mjs` itself: ordinary, deterministic Node.js
  code — **no AI**. It is the referee. It decides what runs next, checks each
  subagent's output against a mechanical rule, and stops the whole run the moment a
  check fails. The subagents do the creative work; the harness refuses to let
  unverified work advance. *That* is what makes the output trustworthy.
- The **human** picks the finding (**H1**) and, at the very end, reads the assembled
  evidence and merges or rejects (**H2**). The core promise is "zero-touch except
  H1/H2": the human never has to run a test, gather evidence, or re-verify anything
  a machine could verify.

### 0.2 What you're assumed to know

Given without explanation below: **git** (branches, commits, and `git worktree` — a
second working directory checked out from the same repo), **pull requests**,
**continuous integration** (CI — the automated checks that run against a PR),
**pytest** (Python's test runner), and the general idea of an **LLM agent** that can
read and write files and run shell commands. If those are familiar, every external
tool named later (GitHub's API, code formatters like `black`, the CodeRabbit review
bot) will make sense from context.

### 0.3 Vocabulary — the terms this project defines

These can't be looked up; they're specific to this system. One line each — enough
to read the guide. Where a term's *full* definition lives in the separate **AIV
specification**, that's flagged rather than invented here.

**The workflow**

- **The spine** — the fixed sequence of stages one finding travels from H1 to H2,
  driven by `driveSpine`. *(Project term, used in the source.)*
- **Stage** — one step in the spine (e.g. "write the plan," "review the PR"). Most
  stages are a single subagent job.
- **Gate** — a deterministic pass/fail check the harness runs on a stage's output.
  A stage advances only when its gate is green. **Fail-closed** means: when in
  doubt, stop — never let unverified work through.
- **HALT** — the harness deliberately stopping the run (a gate failed, or no
  progress is being made). It writes a report and exits; it never guesses.
- **The SEAM** — the `prove-it` stage (source term): where "does the fix
  actually work" is proven by running the *new* test against the *old* code (it
  must fail) and the *fixed* code (it must pass).
- **The back-half** — the later stages (9–12) that converge the PR to a mergeable
  state (source term). Non-linear; see §2.

**AIV — the evidence system**

- **AIV** — "Auditable Verification Standard for AI-Assisted Code Changes": a
  protocol, with a CLI called `aiv`, for attaching provenance and evidence to code
  changes so a reviewer can check them mechanically. Its founding empirical result
  (from the AIV spec's own AI audit) is the **Hunter vs. Validator** finding: an AI
  is excellent at *finding* bugs (~100%) but dangerous at *validating* claims (~40%
  — it "parrots wrong numbers, verifies theater"). AIV's whole design — artifact-
  based evidence, deterministic checks — exists to be a firewall against that. Keep
  this in mind reading this pipeline: every deterministic gate is there because the
  AI cannot be trusted to validate its own work. *(Authoritative source: the AIV
  spec / `aiv-protocol` repo. The lines below are the canonical definitions.)*
- **Two layers.** AIV has a **Layer 1** (per-file `EVIDENCE_*.md`, one per
  `aiv commit`, holding the collected proof) and a **Layer 2** (a per-change
  `PACKET_*.md`, produced by `aiv close`, aggregating the evidence files by SHA).
  This pipeline works with both — `.github/aiv-evidence/` (Layer 1) and
  `.github/aiv-packets/` (Layer 2).
- **Packet** — a Layer-2 "AIV Verification Packet": a structured markdown document
  that **is** the auditable record of a change (sections: Classification, Claims,
  Evidence, one section per evidence class, Verification
  Methodology, Summary). The PR body is a packet. Generated by `aiv close`.
- **Evidence classes A–F** — the kinds of evidence a packet carries. **Canonical
  definitions (AIV spec):** **A** Execution (tests passed in a defined environment),
  **B** Referential (SHA-pinned, line-anchored links to the exact code), **C**
  Negative (absence of disallowed patterns — deleted assertions, skip markers),
  **D** Differential (change *impact* beyond test coverage — API/state/config
  deltas), **E** Intent (alignment with the upstream requirement), **F** Provenance
  (artifact integrity + git chain-of-custody). A seventh, **G** Cognitive (the SVP
  mental-verification phases), is optional and not used here. *Which* classes are
  **required** rises with the risk tier (A+B always; E from R1; C from R2; D+F from
  R3). ⚠ **Divergence from the AIV spec:** `fix_pipeline.mjs` files its
  **lint/type/build** evidence under a **"Class D"** heading (INVARIANT #9;
  `completePacketClasses` emits flake8/black/mypy there). But canonical Class D is
  **Differential** — change-impact evidence across the *surface categories* a change
  touches (API, dependencies, data schema, configuration, security), per
  `aiv-protocol/SPECIFICATION.md §6.5`. Lint/type output is static-analysis /
  code-quality, not one of those categories. The mislabel survives because `aiv check`
  validates section *structure*, not class *semantics*. See §12 AIV-DIV-01.
- **Class E / canonical intent** — the evidence that a change addresses its *stated*
  reason. The protocol requires an **immutable** intent reference — a SHA-pinned spec
  permalink, a versioned issue ID, or a hashed snapshot; a mutable issue/branch URL is
  rejected (`E-001`). This pipeline **narrows** that to specifically a **SHA-pinned URL**
  into the original audit file that produced the finding (built at intake). "SHA-pinned"
  = the link names an exact commit hash, so it can't silently drift to different code.
- **The aiv lifecycle** — the CLI ceremony a code-writing stage performs:
  `aiv begin <id>` opens a change context (relaxing the "1 file + 1 packet" atomic
  rule); `aiv commit <file> -m <msg> -c <claim> -i <intent-url> --requirement <req>
  -r <rationale> -s <summary> [-t <tier>]` commits one file while the tool *runs
  real checks* to collect the evidence (pytest coverage → Class A, `git diff` →
  Class B, anti-cheat scan → Class C, provenance → Class F), which is why it takes
  minutes; `aiv close` builds the Layer-2 packet from those commits; `aiv check`
  validates a packet's *structure* (an 8-stage pipeline), and `aiv audit` its *content
  quality* (TODO remnants, missing SHAs, unverified-claim rates). Deeper semantic
  claim↔evidence *correspondence* is the fix-pipeline's own aiv-audit **stage** (§6),
  not the CLI. When a weak model fumbles this ceremony, the harness performs it (§8).
- **Risk tier (R0–R3)** — how much scrutiny a change needs, and who may verify it:
  **R0** Trivial (docs/formatting; self-verify; checks skippable), **R1** Low
  (isolated bug fixes; self-verify), **R2** Medium (API/config/deps; requires an
  *independent* verifier — Separation of Duties), **R3** High (auth/crypto/payments/
  PII; independent verifier + the full A–F evidence set). Higher tiers require more
  evidence classes and, at R2+, that the author is not the sole verifier.

**The players and named stages** *(a few defined here because §0 uses them; the
**complete, plain-language walkthrough of every stage — what it does and what it
produces — is §2.1**, which is the place to look up any stage name.)*

- **check-drift** — the stage that audits the *plan* before any code is written (the
  plan gate).
- **or-review** — the stage answering one question: "is this PR ready for the human
  to judge?" (all claims verified, evidence complete, review settled).
- **aiv-audit** — the stage that audits the *packet's content* (does each claim
  actually match its evidence?).
- **verify-finding** — an early stage that tries to *falsify* the finding before any
  work is done: is this bug even real? Verdict is `reproduced` / `refuted` /
  `inconclusive`.
- **prove-it** — the SEAM (above).
- **oracle** — in testing, the source of truth a test asserts against.
  **oracle-guard** is a harness check that stops a subagent from *weakening*
  an existing test to make buggy code pass (the classic cheat).
- **CodeRabbit** — a third-party AI code-review bot that posts comments on PRs,
  tagging severity 🔴 Critical / 🟠 Major / 🟡 Minor. The back-half reads and
  addresses its comments (and any human reviewer's).
- **The fleet** — many drives running in parallel, one repo clone each, to fix many
  findings at once.
- **The corpus / traindata** — the recorded trajectory of every drive (prompts,
  outputs, outcomes), captured to later train cheaper models. Optional; off unless
  `FIX_TRAINDATA_DIR` is set.

**Labels this guide coins** (organizing names, *not* project terms): the
**goal-loop path** vs **single-shot path** — the two ways a stage executes (§5) —
and the **two-lane principle** — a deterministic check overriding an agent's
self-report (§6).

### 0.4 How the three repositories fit together

This file is one piece of a **three-repository system**. Reading it in isolation is
confusing until you know the other two exist:

- **`aiv-protocol`** — the *protocol and tool*. Defines what counts as valid
  evidence (the classes, tiers, packet format) and enforces it (the `aiv` CLI,
  git hooks, the guard). `AIV_PRIMER.md` (companion to this guide) summarizes it.
  The pipeline's stages *call* the `aiv` CLI; they never reimplement the spec.
- **`aiv-workflow`** — the *agent workflow*. ~12 Claude Code skills (`launch-brief`,
  `check-drift`, `design-tests`, `prove-it`, `or-review`, `aiv-audit`, `start-pr`,
  `ground-yourself`, `poll-ci`, `rigor-audit`, `aiv-packet`, `fan-out`) plus the
  pipeline blueprint (`docs/PIPELINE.md`) describing *how* an agent drives a finding
  to a merged PR. **Each stage of this pipeline runs one of those skills** —
  `fix_pipeline.mjs` reads their `SKILL.md` at runtime from the repo's canonical
  `skills/` tree (the single source of truth, resolved via the `SKILLS_DIR`
  constant / `AIV_WORKFLOW_SKILLS`) and inlines it into the agent's prompt. The blueprint's two convergence loops and its
  H1/H2 premise are exactly what §2 and §7 describe; this file is their mechanical
  realization.
- **`fix_pipeline.mjs`** (this file, at `orchestration/src/fix_pipeline.mjs`) — the
  *orchestration layer*. `aiv-workflow`'s
  own blueprint lists three things "not yet built," the third being *"the
  orchestration layer that drives stages 1→14 unattended: calls each skill, detects
  the gate state, and advances or loops."* **This file is that layer.** It also
  realizes the other two unbuilt items (an objective convergence terminator;
  enforcement of the all-class evidence mandate) and adds two gates the scaffold
  has no skill for — **`verify-finding`** (falsify the finding before building) and
  **`test-quality`** (adversarially audit the RED tests). `verify-finding` is
  pipeline-local (`skill:null`); `test-quality` is now one of the canonical
  `skills/` (it was forward-ported upstream, no longer pipeline-vendored).

⚠ **Terminology collision to expect:** "Layer 1 / Layer 2" means *different things*
in the two upstream repos. `aiv-protocol` uses them for **evidence granularity**
(per-file evidence vs per-change packet); `aiv-workflow` uses them for **system
architecture** (the protocol vs the workflow). This guide avoids the terms;
`AIV_PRIMER.md` flags both meanings.

---

## 1. What it is, in one paragraph

`fix_pipeline.mjs` is a **deterministic Node harness** — not an LLM — that drives
**one audit finding** from **H1** (a human picked a finding) to **H2** (a human
judges the evidence and merges) through a fixed sequence of stages. Each stage is
a **fresh, isolated `claude -p` subagent**. The harness gates every transition on
a **schema-valid machine artifact** and **HALTs fail-closed** when a gate fails.
Two human touchpoints (H1 in, H2 out) are the only manual transitions; everything
between is mechanical. The entry point is `driveSpine(spec)`; the
per-stage engine is `runLiveStage(...)`.

### The four load-bearing ideas

1. **The git state IS the memory.** Every stage externalizes its work to git
   (commits, the PR) and to the aiv change context. So each retry/iteration is a
   *fresh* agent with a bounded context — the repo state is what carries forward,
   not a growing transcript. This is why `--max-turns` is a per-attempt safety
   valve, never the task cliff.
2. **Termination is the gate, not turns.** A stage is done when its deterministic
   gate goes green, not when the agent "stops finding things." Loops are bounded
   by caps (`PLAN_CAP`, `IMPL_CAP`, `CAP` per loop) with **no-progress detectors**
   that HALT on a repeating signature.
3. **Deterministic lane beats agent self-report.** Wherever a fact is
   mechanically checkable (CI status, packet shape, SHA resolution, actionable
   review count), a harness computation **overrides** the agent's reported value
   before the gate evaluates. See §6. This is the single most important design
   principle to preserve when editing.
4. **Weak model = sensor, not driver.** When *every* model fails identically at
   one point, that's a harness-contract gap, not a capability ceiling — so the
   mechanical parts of a stage (the aiv ceremony, the import line, the formatter,
   the packet's evidence classes) are **owned by the harness**, and the model is
   left only the irreducible semantic act. See §8.

---

## 2. The spine: what `driveSpine` actually does

`STAGES` is the canonical stage list — a **13-element** array whose labels run 0–14
(the "14-stage state machine"; labels `2–3` and `10–11` are collapsed loop-pairs).
`driveSpine` doesn't iterate `STAGES` literally; it runs a hardcoded sequence of
`isDone`-guarded blocks against a **resume cursor**: `state.findings[fid].stages`
records which steps are done, and each `isDone(st)` check skips completed steps, so a
killed drive resumes where it stopped. The stages, in execution order:

| # | Stage | Code anchor | Kind |
|---|-------|-------------|------|
| 0 | fresh-start hygiene + gitignore | `driveSpine` (inline) | mechanical |
| 0 | preflight (auth/tool/handoff) | `doPreflight` | 1 cheap spawn |
| 1 | launch-brief | `LIVE_STAGES` | producer spawn |
| 2–3 | **plan ↔ check-drift (Loop #1)** | `planConverge` | convergence loop |
| 4 | ground (provision venv + capture baseline) | `provisionEnv` + `writeBaseline` | mechanical |
| — | verify-finding (H1 falsification) | `LIVE_STAGES` | gate spawn |
| 5 | design-tests (author RED test) | `driveSpine` (inline) | goal-loop spawn |
| 6 | write-code (make it GREEN) | `driveSpine` (inline) | goal-loop spawn |
| 7 | prove-it (SEAM: before/after) | `LIVE_STAGES` | gate spawn |
| 8 | open/update PR | `openOrUpdatePR` | mechanical |
| 9–12 | **back-half convergence** | `backHalfConverge` | convergence loop |
| 12b | ci-final (confirm green on final head) | `confirmCiSettled` | mechanical |
| 12c | provenance-tag (survive rebase-merge) | `createProvenanceTag` | mechanical |
| 13 | file deferred findings as issues | `fileDeferredIssues` | spawn |
| — | memory-retro (capture lessons) | `memoryRetro` | spawn |
| — | queue write-back + manifest | `driveSpine` (inline) | mechanical |
| — | **park at H2** (agents never merge) | `driveSpine` (inline) | terminal |

**The back-half is the subtle part.** Stages 9–12 are not linear:
`cr-review`, `aiv-audit`, and `pr-summary` each push commits or edit the PR body,
which re-triggers CI and CodeRabbit and invalidates any gate that passed earlier
in the round. So the harness repeats `{reconcile → cr-review → justify-audit →
aiv-audit → pr-summary → poll-ci → or-review}` until a **full round changes
nothing** (head SHA + PR body unchanged, no pr-summary edit) **AND** `or-review`
PASSes on that head. The mutating stages are idempotent (no-op when already
clean), which is what lets the loop terminate. An outer oscillation detector
(`backHalfSig`) HALTs if two rounds leave
the identical unresolved state at the same head — that means the gates are
conflicting, not converging, and it needs arbitration rather than more rounds.

### 2.1 What each stage does — in plain language

The table above is *sequence*. This is *meaning*: what each stage's job is and what
it produces. Read it once; refer back whenever a stage name appears later.

- **fresh-start hygiene** — housekeeping. If a stopped prior attempt left commits or
  junk on the branch, reset it to a clean base so the drive starts from a pristine
  state. Never fires on a real resume.
- **preflight** — one cheap, throwaway subagent call that proves the LLM can
  authenticate, use tools, and hand a file back, *before* committing to a long,
  expensive run. If auth is broken, fail now, not three hours in.
- **launch-brief** — turns the finding into **two documents**. The **brief** is the
  building agent's marching orders: what to do, what decisions it must make, what
  facts to verify. The **completion contract** is a **binary green/red checklist**
  that defines exactly when the change counts as done — every item in the brief has
  a matching verify-item in the contract, so "what to do" and "how you'll know it's
  done" can't drift apart. No code is written here; these are dispatch documents.
- **plan ↔ check-drift (Loop #1)** — the building agent writes a **plan**: which
  files change, the exact commit sequence, which tests go at which layer, and what's
  explicitly *out of scope*. Then **check-drift** — a separate, independent agent —
  audits that plan and either passes it or returns specific objections (structural
  gaps, quality problems, "hard stops"). They loop, plan→audit→revise, until the
  plan converges. The point: make the plan so complete that writing the code is
  mechanical (which is why there is no creative "code-writing" stage later — see
  write-code).
- **ground** — environment setup. Build the project's real test environment (a
  Python `venv`) so tests run exactly as CI would, and record which tests are
  *already* failing on the untouched code — the **baseline** — so that later, only
  *new* breakage counts against the fix.
- **verify-finding** — a falsification check *before* any building. The harness
  pre-runs the finding's own verification commands and shows the real output; the
  agent judges: **`reproduced`** (the bug is real → proceed), **`refuted`** (the code
  is already correct → stop, and send a bug report back to the audit — the finding
  was wrong), or **`inconclusive`** (can't tell → proceed with a caveat).
- **design-tests** — write a **RED test**: a test that *fails* against the current
  code *because it asserts the correct behavior* and the code is still buggy. "RED" =
  failing; it must fail for the right reason (a real assertion about the defect, not
  an import typo). Also writes a **bug-catalog** — a short doc naming each bug the
  tests catch. This captures the bug in an executable form *before* it's fixed.
- **write-code** — implement the plan: make the *smallest* change that turns the RED
  test green without breaking any other test. Deliberately has no creative skill —
  the plan already decided everything; this stage just executes it.
- **prove-it — the SEAM** — produce before/after evidence that the fix actually
  works: run the new test against the *old* code (it must fail) and the *fixed* code
  (it must pass), diffed against the exact baseline commit the finding cites.
  "**SEAM**" = the seal between building and reviewing — nothing unproven is allowed
  to cross it. (This is the stage FIX-01 in §12 is about.)
- **open-PR** — housekeeping: push the branch and open (or update) the pull request,
  using the AIV packet as the PR body.
- **the back-half (Loop #2)** — repeatedly drive the PR to a mergeable state, because
  each change re-triggers CI and review. Its steps:
  - **reconcile** — if a human pushed a commit onto the branch mid-drive, *adopt* it
    into the evidence chain rather than blocking on it.
  - **cr-review** — read the PR's review comments (from **CodeRabbit**, the review
    bot, and any human) and fix the load-bearing ones. Pure nitpicks are
    deliberately skipped: fixing one would re-trigger review and the loop would never
    settle.
  - **justify-audit** — wherever the previous step *defended* a decision instead of
    changing it, an independent agent re-checks that defense **by running the code**.
    A fluent-but-wrong justification is exactly the failure this catches.
  - **aiv-audit** — audit the packet's *content*: does each claim actually match its
    evidence? Does the intent link point at the right source?
  - **pr-summary** — rewrite the PR title and body so the human reads a perfect,
    current summary at merge time (the body goes stale as commits land).
  - **poll-ci** — watch the real CI checks; if a *new* failure appears, dispatch an
    agent to fix it; loop until green (pre-existing failures are tolerated).
  - **or-review** — the readiness gate: "is this PR ready for a human to judge?" —
    all claims verified, evidence complete, CI green, review settled.
  The loop ends when a full round changes nothing *and* or-review passes.
- **ci-final** — confirm CI is *still* green on the exact final commit before
  declaring done (the last review commit re-triggered CI).
- **provenance-tag** — create a git tag so the packet's SHA-pinned evidence links
  keep resolving even after the PR is rebase-merged (rebasing rewrites commit
  hashes, which would otherwise dangle every pinned link).
- **deferred-issues** — file a GitHub issue for every follow-up the work deliberately
  deferred, so nothing is silently dropped.
- **memory-retro** — an agent writes the drive's lessons (what failed, what
  generalizes) into a durable log, so future drives improve.
- **queue write-back / park at H2** — update the finding's queue row with its PR
  outcome, then stop. The PR sits ready; a human judges the evidence and merges.
  **Agents never merge.**

> **One term you'll hit before §6 defines it:** a **machine block** is a small JSON
> block a gate stage's agent emits as its answer — e.g. `{"verdict":"PASS", …}`. The
> harness extracts it, schema-checks it, and the gate judges *the block*, never the
> agent's prose. A stage's pass/fail is a machine block, not an opinion.

---

## 3. How to run it (CLI surface)

`main()` dispatches on flags. The two you'll use most:

- **`--drive --spec <f.json> [--cwd <wt>]`** — the whole spine, H1→H2, resumable.
  This is production.
- **`--drive --plan --spec <f.json>`** — dry preview: prints the spec + resume
  cursor, **no spawns, no side effects**. Use this to see where a
  drive would resume.

Other entry points:

- **`--intake --finding-id <id> --repo <o/n> --repo-path <clone>`** — Stage 0
  only: materialize brief + spec + worktree from a finding id
  (`materializeFinding`). Emits the `--spec` file to drive with.
- **`--run-stage <stage> --spec <f> --cwd <wt>`** — one live stage, supervised;
  **exit 4 = gate not converged** (distinct from HALT).
- **`--selftest`** — zero-API: 411 assertions over the pure predicates + stage
  structure (grows as fixes land; 0 failed is the gate) (`selftest`).
- **`--dry-run`** — zero-API end-to-end over **fixture** gate outputs
  (`drive`, `dryFixtures`). It exercises `loopPlan`/`loopImpl` (the fixture
  walker); the spine's own `planConverge`/`backHalfConverge` carry separate
  selftest fixtures (see §7).
- Per-stage flags for supervised operation: `--poll-ci`, `--audit-loop`,
  `--cr-review`, `--audit-pr-summary`, `--file-deferred-issues`, `--memory-retro`;
  setup flags `--provision-env`, `--capture-baseline`, `--open-pr`, `--check-dup`;
  `--reopen-backhalf` (re-open the back-half so a post-H2 human review is
  re-addressed on the next drive, `reopenBackhalf`).

**Fail-closed launch gate:** a real `--drive` refuses to run unless
`FIX_TRAINDATA_DIR` points at a writable git clone. The corpus
capture is "always on" by operator mandate; an unset/broken sink HALTs *before*
any spawn rather than silently dropping trajectories. `--plan`/`--selftest`/
`--intake` are exempt (no spawns).

---

## 4. The finding-spec: the only per-finding input

A **spec** is the mechanical parameter set for one finding — *what* and *where*,
never *how* (the "how" lives in the plan, gate-enforced). Adding a new finding
needs **only a spec**, never a harness edit — this is the design property that
kills hard-coded finding literals. Fields (built by `materializeFinding` or
`loadSpec`):

- `id`, `repo` (`owner/name`), `cwd` (the worktree), `baseBranch`
- `changeIdPrefix` — derives the aiv change-ids and packet globs
- `planPath`, `intentSource` + `intentLine` (the Class-E audit target),
  `bugSite`, `goalCondition` (the verification string), `findingFile`,
  `headBranch`, `title`

Stage `task`/`verifyCmd` strings are **templates** with `{{PLACEHOLDER}}` tokens
filled by `applySpec`. The selftest asserts *no* token leaks unfilled — that guard
is what lets you add tokens safely. `specGlobs`
and `packetFile` both **lowercase** the prefix because aiv normalizes packet
filenames to lowercase-with-underscores; forget that and an uppercase finding-id
produces globs that never match the real packet (a class of "no packet produced"
HALTs, see the `#54` comments).

**Intake (`materializeFinding`) is fully mechanical H1:** it resolves the
finding's row from the audit file *at the base ref*, builds the
**SHA-pinned canonical-intent URL** every packet's Class E must cite,
runs a **freshness gate** against GitHub (a merged PR ⇒ refuse re-drive unless
`--force`; `freshnessGate`), creates the head-branch worktree,
**disables gpg signing** in that worktree so headless `aiv commit`s don't block on
pinentry, gitignores the scaffolding, scaffolds `.aiv-workflow.yml` if
absent, and writes the brief + `spec_<id>.json`.

---

## 5. The stage engine: `runLiveStage`

This is the heart. One call runs one stage. It has **two execution paths** chosen
by the stage's `commitMode` + `verifyCmd`:

### 5a. Prompt assembly (all stages)
Before spawning, the runner builds a self-contained prompt (`spawnOnce`):
the stage's `SKILL.md` inlined, **every sibling `.md` the skill references
inlined too** (`--add-dir` exposes only `cwd`+`WORK`, not the skill
dir, so a referenced template unreachable from anywhere makes a weak model `find`
the whole FS), the grader's full rubric if `gradedBy` is set (so
author and grader read the *same* contract), a `preserveSections` must-keep list
on re-amends, the cost-drives text if `injectCostDrives`, and for
gate stages a **concrete example instance** built from the schema
(`exampleFromSchema` — a weak model hands the raw schema will echo it back
rather than instantiate it). Deterministic pre-work also runs at stage entry: the
**localization pack** (§8), the **RED-test scaffold** under
`FIX_HARNESS_CEREMONY`, the **bug-catalog**, plan **iteration
state**, the **test-quality deterministic block**, and the
**verify-finding pre-run**. Prompts over `ARG_SAFE` (60 KB) spill
to a file passed by Read-pointer to avoid `E2BIG` (`spillPrompt`).

The spawn itself retries transient failures (auth/network/rate-limit) up to 5×
with backoff (`transientAgentError`) so an environmental blip is
never mistaken for "the agent produced bad output," and captures the
(prompt→completion+diff) pair to the corpus (`recordSpawn`).

### 5b. Goal-loop path — `commitMode:"aiv"` with a `verifyCmd`
For **design-tests** and **write-code**. Iterate a fresh agent until the objective
`verifyCmd` gate goes green, bounded by `CAP` (default 8) with a `STALL_K`-based
no-progress detector. Before the model even spawns, two **idempotent-resume**
skips run: if inherited committed work already passes the
deterministic repairs + gate, the stage completes with **no model spawn** — this
protects already-green code from a fresh agent that would rewrite and re-break it
(the F140/F83 class). Each iteration, after the spawn, the harness runs a
**deterministic repair pipeline** in order:

1. `aivFinalize` — packet any file the model wrote but left unpacketed;
   close/abandon the aiv context. See §8.
2. **oracle-guard** (`oracleGuardLive`) — if a pre-existing test was
   changed without a justified `.aiv/oracle-corrections/*` record, **auto-revert**
   it (a fresh agent won't undo a prior incarnation's damage; only a deterministic
   revert works).
3. **symbol-guard** (`symbolGuardLive`) — restore public symbols a
   whole-file rewrite dropped; reset an unparseable file to base.
4. **collect-gate** (`collectCheck`) — the RED test must import and
   collect ≥1 item; a hallucinated import or empty test file fails here.
5. **regression + determinism gates** (write-code only) — `fullSuiteRegression`
   runs the repo's real suite baseline-subtracted; `autoFormatChanged`
   applies the repo's own pinned formatters (the model can't hand-emulate
   black).
6. **packet completion** (`synthesizePacket` + `completePacketClasses`) — fill
   A–F evidence classes from evidence the harness actually collected.
7. `verifyCmd` — the final deterministic gate.

On stall, **best-of-N resample** (`bestOfNResample`): reset to the
pre-stage HEAD and try `RESAMPLE_N` fresh independent attempts with a
*different approach*, gate-selecting the first passer. It re-scaffolds
each attempt and re-runs the full repair pipeline, so a resample can only turn a
HALT into a **real** pass. Exhaustion HALTs fail-closed.

### 5c. Single-shot path — producer + gate stages
For **launch-brief**, **plan** (producers), and **check-drift / or-review /
aiv-audit / prove-it / verify-finding / test-quality** (gates). Spawn once, with
bounded `STAGE_RETRY` re-spawns on an **OUTAGE-class slip**: a producer
that narrated its artifact instead of Write-ing it (recovered
deterministically), or a gate that returned no parseable block / a schema-echo /
placeholder values. For a gate stage the verdict is extracted → coerced →
validated → judged by `GATE_FN[s.gate]`. `haltOnGateFail` gates HALT on
failure; non-halt gates return `gatePass` for the spine's loops to
orchestrate.

**LIVE_STAGES field contract** (the `LIVE_STAGES` table). To add or change a stage, these
are the knobs: `skill` (inlined SKILL.md, or `null`), `gradedBy` (inline another
skill's rubric), `model` (tier), `gate` (schema name → single-shot gate path),
`commitMode` (`"aiv"`|`"plain"`), `readOnly` (verdict off-branch, worktree left
pristine), `haltOnGateFail`, `verifyCmd` (→ goal-loop path), `expects` (producer
artifact path), `resampleFallback`, `localize`, `collectGate`, `regressionGate`,
`determinismGate`, `symbolGuard`, `injectCostDrives`, `requireSections`,
`maxTurns`, `timeoutMs`.

---

## 6. The gate model (the trust boundary)

Every gate flows through the same pipeline: **extract → coerce → validate → judge**.

- **Extract** (`extractMachineBlock`): pull the *last* `## Machine-checkable
  data` fenced block from the artifact, falling back to brace-slicing tolerant
  JSON. The live gate runner wraps two further recovery layers around it: `#100`
  prose-narration recovery and `scavengeBlock` (`#136`) if the model wrote to a
  hallucinated path.
- **Coerce** (`coerceEnums`): normalize enum drift (`PASS`/`passed`/`ok` →
  `PASS`) via `ENUM_SYNONYMS` before validation.
- **Validate** (`validate`): recursive, enum-checked schema validation against
  `SCHEMAS`. Also guarded: `isSchemaEcho` (the model wrote the schema
  back) and `placeholderFields` (left `<...>` templates in, a false-pass
  otherwise).
- **Judge**: the pure gate predicate in `GATE_FN`.

| Schema | Gate predicate | Passes when |
|--------|---------------|-------------|
| `check_drift_verdict` | `gatePlanConverged` | audit-depth complete, `plan_quality` & `plan_graph` not `"fail"`, no hard-stops, no unresolved missing sections |
| `or_review_verdict` | `gateOrReview` | all contract items verified/N-A, PASS, 0 unverified/falsified, stop-condition `none`, 0 actionable, all classes present |
| `aiv_audit_result` | `gateAivAudit` | not NON-COMPLIANT, 0 blocking findings |
| `test_quality_verdict` | `gateTestQuality` | four booleans true + 0 blocking |
| `prove_it_manifest` | `gateProveIt` | `unverified_count==0`, ≥1 claim PASS, and every claim resolved — PASS **or** a rationalized N/A (`claimResolved`) |
| `finding_verdict` | `gateFindingVerified` | `reproduced` ⇒ pass; `inconclusive` ⇒ pass unless `STRICT`; `refuted` ⇒ never |

**The two-lane principle — preserve this when editing.** Where a value is
mechanically decidable, the harness computes it and **overrides the agent's
self-report before the gate sees it**. The three canonical cases:

- `or_review_verdict.coderabbit_actionable` is recomputed by `crActionableCount`
  and overridden (`#126`) — the model's count varies per
  judge on the same PR.
- `aiv-audit` compliance is decided by *authoritative signals* (0 agent-lane
  findings + deterministic `aiv audit`/`aiv check`/provenance clean), not the
  agent's `packet_decision` (`auditFixLoop`) — with two
  loop terminators (`#124` ratchet, `#125` churn) that stop a stochastic judge
  from re-litigating an unchanged head.
- `or-review` does **not** gate on `aiv_classes_vacuous` — vacuity is aiv-audit's
  authoritative domain (`#29`).

**Exit-code taxonomy** (the `main` catch): `0` success/preview · `2`
fatal/config · `3` HALT · `4` gate-not-converged (`--run-stage`, `--seam-check`, or the `#166` graded-artifact HALT) · `5`
REFUTED (a first-class terminal — `haltRefuted` writes the bug report back to
the *audit*, not the repo).

---

## 7. The two convergence loops

**Loop #1 — plan ↔ check-drift** (`planConverge`, called by `driveSpine`). The plan
producer and the check-drift gate iterate: check-drift returns a risk tier that's
fed back so the plan is graded against the same contract it's told (`#74`); a
clobber-guard restores the plan if a weak agent overwrites it with a JSON stub
(`planIsGood`); a no-progress detector HALTs on the same
hard-stops twice. Converged plans are backed up off-branch to `WORK`
so a `git reset` can't destroy the slow artifact (`restorePlan`).

**Loop #2 — the back-half** (`backHalfConverge`, called by `driveSpine`). Described
in §2.

**A note on `loopPlan` / `loopImpl`.** These are a *separate, simpler* abstraction
used only by `drive()` (the dry-run/selftest fixture walker) — never by `driveSpine`
(verify: `grep -nE '\bloop(Plan|Impl)\(' orchestration/src/fix_pipeline.mjs`). `#161`
extracted the shipped loops into `planConverge`/`backHalfConverge`, which now carry
their **own** selftest fixtures (so mutating the `stable` predicate goes RED) — the
old "tested ≠ shipped" gap (FIX-05) is closed. See §12.

---

## 8. Harness-owns-ceremony (the FIX_HARNESS_CEREMONY subsystem)

The philosophy from §1.4, made concrete. When a stage's mechanical scaffolding
overwhelms a weak model, the harness owns the mechanism and leaves the model the
irreducible act. Gated by `FIX_HARNESS_CEREMONY=1` where noted; several parts run
always.

- **Localization pack** (`buildLocalizationPack`, always for `localize`
  stages): deterministically resolves the plan's `§10` edit-target files, emits a
  **skeleton** (`pySkeleton` collapses non-target bodies, keeps target bodies
  and imports) so a weak model isn't confused by full files. Off-branch under
  `WORK`.
- **RED-test scaffold** (`scaffoldRedTest`, gated): pre-writes the test file
  with a **verified-working import** already in place (the import was the observed
  1B blocker — it resolves candidate module paths and confirms each by running
  `python -c "<import>"` in the venv), plus **FACT lines** from
  pre-running the finding's own verification commands (`#149`, so the model asserts
  the *real* expected value rather than inventing one), leaving only a
  `SCAFFOLD_SENTINEL` line for the model to replace with the assertion. If
  the sentinel survives into a commit, `collectCheck` fails closed.
- **Bug-catalog** (`scaffoldBugCatalog`): the catalog's content is recorded
  ground truth (finding fields + harness-executed values), so the harness writes it.
- **verify-finding pre-run** (`vfPreRun`): the harness runs the finding's own
  commands live and injects the real outputs, then fills the mechanical
  `repro_command`/`observed`/`expected_per_finding` fields so a 1B model need only
  emit the one-word verdict (`#137`). A **`refuted` requires substantive affirmative
  evidence** or it's downgraded to the safe `inconclusive` (`#139`,
  `refutationSubstantive`) — a false `refuted` silently kills a real finding.
- **aiv ceremony recovery** (`aivFinalize`): the weak model writes files but
  fumbles `aiv begin → commit-with-6-flags → close`. The harness commits every
  unpacketed functional file with the correct flags (intent URL from the finding),
  and handles every deadlock class it observed: in-progress-merge abort (`#114`),
  immutable-packet regeneration (`#103.2`), empty-context abandon (`#110.1`),
  name-collision-variant cleanup (`#110.2`).
- **Packet completion** (`synthesizePacket` creates one from git state when
  the model committed via plain git; `completePacketClasses` fills missing
  A–F sections) — from evidence the gates *actually* collected, run only *after*
  the code is verified green. Not fabrication: every line restates a gate result.
- **Micro-repair** (`applyMicroFix` / `applyMicroAssert`, gated):
  when the gate has proven the remaining delta is one line, the model returns it as
  plain text and the harness applies + compiles + requires-green + reverts-on-fail.

---

## 9. State, resume, and the WORK directory

`WORK` defaults to `<script-dir>/fix/.work` — anchored to the *script
dir*, not `cwd`. `isolateWork` redirects it to a temp dir **only** for
`--selftest`/`--dry-run` so test runs never clobber a live drive's cursor.

- **`state.json`** (`statePath`): the resume ledger. `saveState` writes
  **atomically** (temp + rename) because a truncated write silently reset a cursor
  to "fresh" and discarded committed progress. Structure: `{ findings: { <fid>:
  { spec, stages: {<stageKey>: {...}}, pull, prUrl, updated } } }`.
- **`baseline_ci.json`** (`ciBaselinePath`) + **`baseline_failures.json`**
  (`baselinePath`): pre-existing CI/test failures to subtract, so only *new*
  breakage blocks. ⚠ These are WORK-global and unstamped — see FIX-02 in §12.
- **`HALT_*.md`**, **`REFUTED_*.md`**, **`verdicts/<prefix>/*.md`** (off-branch
  gate verdicts), **`localization/`**, **`plan.backup.md`**, per-attempt
  `stage_*.json` / `a_*.json` / `prompt_*.md` scratch.

**Two HALT mechanisms** (know this — it's a real inconsistency). The class-`Halt`
path (`halt`) persists `status:"halted"` to state. The live-loop halts
(`haltStage`, `halt9`/`halt10`/`halt12` in the poll-ci/audit/pr-summary loops,
and inline `process.exit(3)` in `driveSpine`) write a `HALT_*.md` marker and exit
**without** setting `status`. Resume works regardless (it keys off the stage
cursor), but fleet triage that reads `status` misses every back-half halt. See
FIX-04 in §12.

---

## 10. Agent-facing contracts (injected into every spawn)

Three constants are appended to agent prompts via `--append-system-prompt` and
inline injection. Editing agent behavior usually means editing one of these, not a
stage task:

- **`INVARIANTS`** — the 13 numbered rules every worker obeys: no claim
  without path:line, adversarial verification, no PII/PHI exfil, never merge/bypass
  a gate, atomic commits, per-stage output contract, ground-truth over
  approximation, scope-is-a-constraint, uniform A–F evidence, the operator cost
  function, zero-touch except H1/H2, environment + local-only-git discipline.
- **`AIV_PACKET_CONTRACT`** — the exact `aiv check` blocking rules a
  packet author must satisfy (how the packet is built from `aiv commit` flags,
  E010 bug-fix provenance, E004 intent immutability, no placeholders, all classes,
  stay in scope). Injected into every `commitMode:"aiv"` stage.
- **`COST_DRIVES`** (rendered by `costDrivesText`) — the 5
  agent-vs-operator cost-function conflicts (scope-minimization, exemption,
  approximation, false-completion, cheap-proof-over-live-fire), mined from 708
  operator decisions. Encoded at three defense-in-depth layers: the agent prompt
  (INVARIANT #10), the plan producer, and the check-drift gate (GT-3).

---

## 11. Telemetry / traindata corpus

Off by default; a pure no-op unless `FIX_TRAINDATA_DIR` is a clone (§3's launch
gate makes it mandatory for `--drive`). `recordStep` appends scrubbed JSONL
per drive; `recordSpawn` captures every spawn's (prompt → completion +
produced-diff) pair including failed attempts (the negative examples);
`traindataPush` commits + rebases-on-reject to a shared remote (N fleet
agents push concurrently); `writeTraindataManifest` writes the terminal
label. **Scrubbing is strict** (`scrubText`): a high-confidence secret hit
**drops the field** (`_SECRET_RX`); PII/local-paths are redacted in place. The
`aiv/<changeIdPrefix>` provenance tag is the join key. Instrumentation is
**non-fatal by construction** — a lost training step must never break a fix.

---

## 12. Known sharp edges

Read these before you touch the relevant subsystem.

Several edges below were live defects when this guide was first drafted; each has
since been closed by a numbered learning (the source comment carries the matching
`FIX-0X` tag). They are kept — with their remediation and any residual — because the
*reason* a guard exists is regression rationale a maintainer must not discard.

- **FIX-01 (was HIGH — CLOSED by `#157`/`#162`):** `prove-it` used to be the one
  self-attested link in the fix-reality chain — `gateProveIt` judged only the agent's
  manifest and no harness `_exec` re-ran the RED test at the baseline. `#157` added
  `seamReExec`: once the manifest gate passes, the harness itself re-executes the seam
  (the new test(s) must be **RED at the cited base ref** — via an isolated revert of
  the finding file, or a throwaway base worktree — and **GREEN at HEAD**), writes
  `HARNESS-EXECUTED` evidence, and **fails the gate** on any seam failure (`prove-it`
  is `haltOnGateFail`); `#162` additionally pre-executes it. *Residual:* the SKILL.md
  bar #4 "independent assessor (not you)" is still discharged by the human at H2, not a
  pipeline stage, and `verify-finding` still defaults to *proceed* on `inconclusive`
  (`gateFindingVerified`; set `FIX_VERIFY_FINDING_STRICT=1` to HALT instead).
- **FIX-05 (was MEDIUM — CLOSED by `#161`):** the tested loops and the shipped loops
  were once parallel implementations. `#161` extracted the shipped loops into
  `planConverge`/`backHalfConverge` (called by `driveSpine`) and put them under
  selftest fixtures, so mutating the `stable` predicate now goes RED (§7).
  `loopPlan`/`loopImpl` survive only as the `drive()` fixture walker.
- **FIX-02 (was MEDIUM — CLOSED by `#158`):** baseline caches are now **stamped** with
  `{repo|changeIdPrefix}` (`BASELINE_STAMP`/`stampOf`): a stamp mismatch is treated as
  absent and recomputed, and fresh-start hygiene deletes both caches. *Residual:* the
  caches are still WORK-global *in path* — the stamp, not the path, prevents
  cross-finding reuse.
- **FIX-04 (was LOW — CLOSED by `#159`):** the four named live-loop halts
  (`halt9`/`halt10`/`halt12`/`haltStage`) now call `markHalted`, which persists
  `status:"halted"` before `exit(3)`. *Residual:* a few unnamed halts (`ci-final`,
  `cr-review`, `justify-audit`, `provenance-tag`, some inline `driveSpine` exits) still
  exit without it.
- **FIX-03 (was LOW — CLOSED by `#160`):** `surfaceAdvisories` now appends the advisory
  file to the PR body and HALTs if it can't, so the "0 load-bearing unverified" property
  no longer silently depends on a human opening a WORK file. (The `#124`/`#125`
  terminators are the real advisory downgraders; the earlier `#29` attribution was
  imprecise — `#29` de-double-gates vacuity to aiv-audit.)
- **AIV-DIV-01 (open — a labeling divergence to decide):** `fix_pipeline.mjs` files its
  **lint/type/build** evidence under **Class D** (INVARIANT #9; `completePacketClasses`).
  Canonical Class D is **Differential** — change-impact evidence across the surface
  categories a change touches (API, dependencies, data schema, configuration, security;
  `aiv-protocol/SPECIFICATION.md §6.5`) — and lint/type is not one of those categories
  (it is static-analysis / code-quality, not a differential diff). The mislabel survives
  because `aiv check` validates section *structure*, not class *semantics*. Consequence:
  these packets advertise Differential evidence they don't contain, and omit the
  Differential evidence a reviewer may expect for an R3 change. This is a **decision, not
  a confirmed bug**: either relabel (move lint to a code-quality section and supply real
  Differential evidence for D) or document the local convention. See `AIV_PRIMER.md`.

> **Canonical AIV reference:** the definitions in §0.3 and the divergence above are
> drawn from the `aiv-protocol` repo (the authoritative spec), not inferred from
> `fix_pipeline.mjs`. A standalone `AIV_PRIMER.md` accompanies this guide with the
> full evidence-class table, per-tier requirements, the two-layer architecture, and
> the `aiv` lifecycle — read it if any AIV term here is still opaque.

---

## 13. How to extend it

- **Add a finding:** produce a spec (via `--intake` or hand-write the JSON). No
  code change. The `applySpec` no-leak selftest protects you.
- **Add a stage:** add a `LIVE_STAGES` entry (§5 field contract), add it to
  `STAGES` and the `driveSpine` sequence, and — if it's a gate — add a schema
  to `SCHEMAS` and a predicate to `GATE_FN`. Then add selftest coverage
  for the predicate (the suite tests both the pure predicates and, since `#161`, the
  shipped loops — see §7).
- **Change a gate's strictness:** edit the pure predicate in `GATE_FN`, add a
  selftest asserting both the pass and the block case (that's the existing
  convention — every predicate has both).
- **Change agent behavior globally:** edit `INVARIANTS` / `AIV_PACKET_CONTRACT` /
  `COST_DRIVES` (§10), not individual task strings.
- **Add a deterministic override:** compute the value harness-side and override the
  verdict field before `GATE_FN` runs (the `#126` pattern). This is how you
  keep a stochastic self-report from gating.

## 14. How to read the source

- **Section banners** (`─────── name ───────`) delimit subsystems; grep them for a
  table of contents.
- **`#NN` comments** are numbered learnings — each documents a specific observed
  failure (a drive id like F82/F140/F017-v4, or PR #14 round 5) and the fix. When a
  branch looks over-defensive, its `#NN` explains the drive that caused it; treat
  these as regression rationale — **do not delete a guard without understanding its
  `#NN`.** ~130 of them (IDs run past `#190`); they are the real changelog.
- **Locating a reference:** this guide cites functions and symbols by name, not line
  number. To find one, grep the name in `orchestration/src/fix_pipeline.mjs` — the
  names are stable even as line numbers drift.

---

## Machine-checkable data

```json
{
  "schema": "maintainer_guide_index@1",
  "subject": "fix_pipeline.mjs",
  "entry_points": { "spine": "driveSpine", "stage_engine": "runLiveStage", "cli": "main" },
  "control_flow": {
    "stages_list": "STAGES",
    "loop1_plan_checkdrift": "planConverge",
    "loop2_backhalf": "backHalfConverge",
    "fixture_walker_loops": ["loopPlan", "loopImpl"],
    "terminal_park_H2": "driveSpine"
  },
  "gate_pipeline": { "extract": "extractMachineBlock", "coerce": "coerceEnums", "validate": "validate", "judge_map": "GATE_FN" },
  "gate_predicates": [
    "gatePlanConverged", "gateOrReview", "gateAivAudit",
    "gateTestQuality", "gateProveIt", "gateFindingVerified"
  ],
  "deterministic_overrides": ["crActionableCount", "auditFixLoop", "seamReExec"],
  "ceremony_subsystem": {
    "localization": "buildLocalizationPack", "scaffold": "scaffoldRedTest",
    "vf_prerun": "vfPreRun", "aiv_finalize": "aivFinalize",
    "synthesize_packet": "synthesizePacket", "complete_classes": "completePacketClasses",
    "flag": "FIX_HARNESS_CEREMONY"
  },
  "state": { "cursor": "state.json (saveState, atomic)", "ci_baseline": "baseline_ci.json", "regress_baseline": "baseline_failures", "work_default": "WORK" },
  "agent_contracts": { "invariants": "INVARIANTS", "packet": "AIV_PACKET_CONTRACT", "cost_drives": "COST_DRIVES" },
  "exit_codes": { "0": "success/preview", "2": "fatal/config", "3": "HALT", "4": "gate-not-converged", "5": "REFUTED" },
  "config_env": ["FIX_TRAINDATA_DIR(required for --drive)", "FIX_HARNESS_CEREMONY", "FIX_PLAN_CAP", "FIX_RESAMPLE_N", "FIX_MODEL_GATE", "FIX_MODEL_EXEC", "FIX_MODEL_CODE", "FIX_STAGE_RETRY", "FIX_VERIFY_FINDING_STRICT", "FIX_WORK", "FIX_RETRO_MAX", "FIX_LOC_MAX_FILES", "FIX_LOC_MAX_BYTES"],
  "sharp_edges_closed": { "FIX-01": "#157/#162", "FIX-02": "#158", "FIX-03": "#160", "FIX-04": "#159", "FIX-05": "#161" },
  "sharp_edges_open": ["AIV-DIV-01 (lint/type labeled Class D; canonical D is Differential — decision pending)"],
  "coverage": "all functional regions read in full across the two-pass audit + this guide's closing reads"
}
```
