# aiv-workflow

The **agent workflow layer** for the [AIV protocol](https://github.com/Black-Box-Research-Labs/aiv-protocol).
A Claude Code plugin of skills that drive a project from an **audit finding** all the way to a
**merged PR**, with self-verification gates so the human is the final *judge* of evidence, not the
verification layer.

## Two layers, one system

```
aiv-protocol   ── the PROTOCOL + TOOL ──  what evidence is valid (spec, classes A-G, R-tiers),
(Layer 1)                                  ENFORCE it (hooks, guard, anti-cheat),
                                           COLLECT it (polyglot evidence collector),
                                           `aiv init` = AIV-ify any project.
      ▲
      │ skills CALL the `aiv` CLI; they never reimplement the spec
      │
aiv-workflow   ── the AGENT WORKFLOW ──   HOW an agent drives finding -> plan -> build ->
(Layer 2, here)                            review -> merge. 13 skills + the pipeline design +
                                           an orchestration harness + a per-project config.
```

`aiv-protocol` knows *what counts as evidence and enforces it*. `aiv-workflow` knows *how an agent
produces and audits that evidence across a PR's life*. This repo is Layer 2.

## What's in the box

Thirteen skills — eleven pipeline-stage skills grouped by phase, plus two cross-cutting ones (full
design in [`docs/PIPELINE.md`](docs/PIPELINE.md)):

| Phase | Skills |
|---|---|
| **Plan** | `launch-brief` (finding -> brief + completion contract), `check-drift` (independent convergence gate on the plan) |
| **Build** | `start-pr` (pre-flight ritual), `ground-yourself` (write down the understanding), `design-tests` (bug-catalog-first tests), `aiv-packet` (verification packet per commit), `prove-it` (behavioral evidence: render-and-look, end-to-end, cited-baseline) |
| **Review** | `or-review` (multi-angle independent review), `aiv-audit` (packet content vs spec + evidence harvest), `rigor-audit` (any-PR verification rigor), `poll-ci` (watch CI, carry signals back) |
| **Cross-cutting** | `fan-out` (the shared multi-angle investigation + claim-verification protocol the plan/review skills reuse), `test-quality` (adversarial fail-closed audit of `design-tests` output; wired as a gate stage by the orchestration harness) |

The two hard invariants the design enforces: **context isolation** at the build->review boundary
(the reviewer never hears the implementer's reasoning), and an **evidence chain** preserved from the
original finding through to the merge judgment.

The skills can be driven by hand, or unattended: [`orchestration/`](orchestration/README.md) ships a
deterministic harness (`src/fix_pipeline.mjs`) that drives every stage from finding to
awaiting-merge, gating each transition on a schema-valid machine verdict and halting fail-closed.
[`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) is its operating manual. The harness is
**model-agnostic** — gates decide on schema-valid evidence, never on the model's identity — so drives
run on Claude, on **free OpenRouter models**, or **fully local Ollama models** via a drop-in driver
shim ([`orchestration/drivers/openrouter/`](orchestration/drivers/openrouter/README.md)).

Findings don't have to come from an audit. A **feature, consistency, or refactor** task is driven by
**drafting a finding** — "required behavior is ABSENT," anchored to a machine-checkable **external
oracle** the agent cannot author or weaken — and then runs the exact same pipeline
(`launch-brief` classifies it `feature-absent` natively). [`docs/DRAFTING-DRIVES.md`](docs/DRAFTING-DRIVES.md)
is the runbook.

Wondering what this produces in practice? [`docs/CASE-STUDY.md`](docs/CASE-STUDY.md) walks a real
merged, free-model-driven PR end to end — the evidence, the costs (~$0-19/drive, ~13 min of human
judgment per merge), the pre-flight checklist, and the recipe for independently re-verifying any
finished drive.

## Install

First install the **`aiv` CLI** (Layer 1). It is **not published to PyPI** — install it from source out
of the [aiv-protocol](https://github.com/Black-Box-Research-Labs/aiv-protocol) repo (Python ≥3.10):

```bash
git clone https://github.com/Black-Box-Research-Labs/aiv-protocol.git
pip install -e ./aiv-protocol        # editable install; puts `aiv` on PATH
#   for multi-language evidence collection, add the extra:
#   pip install -e "./aiv-protocol[polyglot]"
aiv --help                           # verify: init / check / begin / commit / close / svp
```

Then add this plugin:

```
/plugin marketplace add github:Black-Box-Research-Labs/aiv-workflow
/plugin install aiv-workflow@black-box-research-labs
```

Then, in each project you want to use it on:

1. Make sure the project is AIV-enabled (`aiv init` from aiv-protocol if not).
2. Copy `config/aiv-workflow.config.example.yml` to `<repo-root>/.aiv-workflow.yml` and edit
   the bindings (paths, branch naming, CI commands, plan archetypes). Every key has a default; most
   projects only set a handful.

The skills read `.aiv-workflow.yml` at the start of a run and fall back to documented defaults
when a key (or the whole file) is absent.

## Requirements

- The [`aiv` CLI](https://github.com/Black-Box-Research-Labs/aiv-protocol) on PATH (Layer 1) — see **Install** above (it is not on PyPI; install from source).
- `gh` (GitHub CLI) for review/CI skills.
- Project-specific tooling per your config (e.g. a test runner, Playwright) for `prove-it` / `poll-ci`.

## Status

`v0.1.0`. The plugin ships the 13 skills plus the [`orchestration/`](orchestration/) harness that
drives them unattended. See [`docs/PIPELINE.md`](docs/PIPELINE.md) for the design,
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for how skills are kept project-agnostic, and
[`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) for the harness.
