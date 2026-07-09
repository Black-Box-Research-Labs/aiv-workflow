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
(Layer 2, here)                            review -> merge. 11 skills + the pipeline design +
                                           a per-project config.
```

`aiv-protocol` knows *what counts as evidence and enforces it*. `aiv-workflow` knows *how an agent
produces and audits that evidence across a PR's life*. This repo is Layer 2.

## What's in the box

Eleven skills, grouped by pipeline phase (full design in [`docs/PIPELINE.md`](docs/PIPELINE.md)):

| Phase | Skills |
|---|---|
| **Plan** | `launch-brief` (finding -> brief + completion contract), `check-drift` (independent convergence gate on the plan) |
| **Build** | `start-pr` (pre-flight ritual), `ground-yourself` (write down the understanding), `design-tests` (bug-catalog-first tests), `aiv-packet` (verification packet per commit), `prove-it` (behavioral evidence: render-and-look, end-to-end, cited-baseline) |
| **Review** | `or-review` (multi-angle independent review), `aiv-audit` (packet content vs spec + evidence harvest), `rigor-audit` (any-PR verification rigor), `poll-ci` (watch CI, carry signals back) |

The two hard invariants the design enforces: **context isolation** at the build->review boundary
(the reviewer never hears the implementer's reasoning), and an **evidence chain** preserved from the
original finding through to the merge judgment.

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

`v0.1.0` scaffold. See [`docs/PIPELINE.md`](docs/PIPELINE.md) for the design and
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for how skills are kept project-agnostic.
