# Genericization conventions

How aiv-workflow skills stay project-agnostic. Every skill ported into this repo MUST follow these
rules so the same `SKILL.md` runs on any AIV-enabled project, not just the one it grew up in.

## 1. The config is the only place project facts live

A skill is agent-read markdown. "Reading config" means the skill *instructs the agent* to load the
project config before acting:

> Read `.aiv/workflow.config.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). If absent, use the defaults named inline below and say so.

Reference config values by **dotted key in backticks, with the default in parentheses** on first use:

> Write the packet under the configured packets dir (`aiv.packets_dir`, default `.github/aiv-packets`).

Never hardcode an absolute path, a repo name, a `§`-section number, a branch string, or a memory
file. If a skill needs one, it comes from a config key. If no key fits, add one to
`config/aiv-workflow.config.example.yml` in the same change.

## 2. Substrate operations go through the `aiv` CLI

Anything the AIV protocol owns (validate a packet, collect evidence, classify, init a project, run
the guard) is invoked via `aiv.cli` (default `aiv`). Skills do not restate the spec's rules (header
strings, class-by-tier tables, CT-rule IDs) as if they were skill knowledge: they call the tool and
read its output. The skill's job is *orchestration and judgment*, not enforcement. When a skill must
explain a spec concept for the agent's benefit, it points at `aiv.spec_path` rather than copying it.

## 3. Methodology is portable; bindings are configured

| Stays in the skill (portable) | Moves to config (bound) |
|---|---|
| phases, gates, the order of operations | repo paths, packets/evidence dirs |
| anti-patterns, the falsifiability bar | branch + worktree naming |
| verification methodology (4a-4d, falsifier gate, render-and-look) | plan dir + tier archetypes |
| the all-class mandate logic | the `§`-section map (review.spec_sections) |
| what a good claim / N/A rationale looks like | CI commands, test/e2e runners |
| | memory dir + which lessons apply |

## 4. Universal lessons travel; project lessons do not

The original skills cite `[[feedback_*]]` / `[[project_*]]` memory entries that exist only on
black-box. When porting:

- A lesson that is **universally true** (no autonomous merge, rebase-only, local-CI before push,
  read the CR body, never edit a test to make it pass) becomes part of the skill's own prose, stated
  as a principle. It does not depend on a memory file existing.
- A lesson that is **project-specific** (a particular submodule init, a Docker bind-mount race, a
  named incident) becomes a config hook (e.g. `branch.postcreate`) or is dropped from the portable
  skill. The host project keeps it in its own memory.

A ported skill must not contain a `[[name]]` link that only resolves on black-box.

## 5. Graceful degradation

A skill must do something sensible when config is partial or absent: auto-detect what it can (repo
root, project name, memory dir), use the documented default for the rest, and state which defaults it
fell back to. A missing optional binding (e.g. no plan archetypes) disables that sub-check with a
one-line note, never a hard failure.

## 6. The porting checklist (run per skill)

- [ ] No absolute path, repo name, or `§`-number hardcoded; all via config keys.
- [ ] Every substrate operation calls `aiv.cli`; no restated spec rules.
- [ ] Every config key the skill uses exists in `config/aiv-workflow.config.example.yml`.
- [ ] No `[[memory]]` link that only resolves on the origin project; universal lessons inlined.
- [ ] Defaults documented inline; degradation path stated.
- [ ] `description` frontmatter scrubbed of project-specific nouns (no "BBRL", "§15.3", "γ-lineage").
