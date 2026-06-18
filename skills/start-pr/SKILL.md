---
name: start-pr
description: Begin work on a new PR with a disciplined, empirical pre-flight ritual - read project memory, verify the primary repo is on a clean base, create an isolated worktree on a fresh branch, run any project pre-flight steps, load the active plan, ground yourself, surface the ritual list, then wait for explicit confirmation before any code change. Use when starting any PR or when the user says "start PR", "begin pr", "next pr", or "let's start the next PR".
---

# Start a PR - full pre-flight ritual

You are starting work on a PR. Do NOT skip steps, and do NOT touch code until the final confirmation
gate clears. The sequence below is the pre-flight ritual: read state, isolate, load the plan, ground,
confirm. Each step exists because skipping it has cost real wedge-investigation time on real projects.

> **Config.** Read `.aiv-workflow.yml` at the repo root (`git rev-parse --show-toplevel`; override via
> `$AIV_WORKFLOW_CONFIG`). Keys used: `project.repo_root` (default: `git rev-parse --show-toplevel`),
> `project.name` (default: basename of repo root), `branch.pattern`
> (default `feat/{stage}-pr-{slug}-{brief}`), `branch.worktree_pattern`
> (default `{root_parent}/{project}-pr-{slug}`), `branch.base` (default `origin/main`),
> `branch.postcreate` (default: none), `branch.install_cmd` (default `npm ci`), `plans.dir`
> (default `~/.claude/plans`), `memory.dir` (default `auto`), `memory.index` (default `MEMORY.md`),
> `aiv.cli` (default `aiv`), `aiv.init_cmd` (default `aiv init`). If the file is absent, use these
> defaults and say so. A missing optional binding disables only its sub-step (with a one-line note),
> never the whole ritual.

## 0. Ensure the project is AIV-enabled

If the repo has no `.aiv.yml` at its root, the project has not been AIV-ified yet. Run the configured
init (`aiv.init_cmd`, default `aiv init`) once, at the repo root, BEFORE anything else. This creates
`.aiv.yml`, the packets/evidence dirs, and installs the pre-commit + pre-push hooks the rest of this
ritual (and every commit you make) depends on. If `.aiv.yml` already exists, skip this step.

Do not confuse the two config files: `.aiv.yml` is aiv-protocol's own config (created by init);
`.aiv-workflow.yml` is this plugin's per-project config (the one in the box above).

## 1. Read memory (always)

Read the memory index (`memory.dir`/`memory.index`; `memory.dir: auto` resolves to
`~/.claude/projects/<encoded-repo-root>/memory`). Pull every project-state and feedback/lesson entry,
and surface anything relevant to the current work. If the user named a specific PR, pull the entries
whose slug or stage prefix matches it.

Do NOT skip this because you "remember from last session" - you don't. The session boundary is real;
memory is the persistence layer.

## 2. Verify primary-repo state

Run `git branch --show-current` and `git worktree list` from `project.repo_root`. Confirm:

- The primary repo is on its base branch (`branch.base` without the remote prefix, e.g. `main`), or
  the operator-named base.
- `git fetch origin` is fresh.
- No stale worktree exists at the path you're about to create.

If the user is already inside a worktree, confirm it is the correct one for this PR and skip to step 4
(do not re-create).

## 3. Create the PR worktree

Always ship a named PR from its own isolated worktree (sibling of the primary repo). This is what
keeps parallel work from colliding; working directly in the primary repo breaks that isolation.

Resolve the names from config:

- **Worktree path** from `branch.worktree_pattern` (default `{root_parent}/{project}-pr-{slug}`),
  where `{root_parent}` = `dirname(repo_root)`, `{project}` = `project.name`, `{slug}` = the PR's
  short kebab-case id (e.g. `cb`, `dd`, `d12-sc`).
- **Branch name** from `branch.pattern` (default `feat/{stage}-pr-{slug}-{brief}`), with `{stage}`,
  `{slug}`, and a short `{brief}` substituted.
- **Base** from `branch.base` (default `origin/main`).

```bash
cd "$(git -C <repo_root> rev-parse --show-toplevel)"
git fetch origin
git worktree add <worktree_path> -b <branch_name> <branch.base>
cd <worktree_path>
```

**Project pre-flight (`branch.postcreate`).** Some projects need mandatory steps right after the
worktree exists, before any code or container ever touches it - and a missing one can wedge the build
in ways that are expensive to diagnose later. `git worktree add` does NOT recursively initialize
submodules, and some toolchains race on lazily-created bind-mount directories. If your project has any
such step, declare it ONCE in config as `branch.postcreate` and run each entry here in order:

```bash
# Run each branch.postcreate entry, in order, from the new worktree root.
# These are PROJECT-SPECIFIC - keep them in config, never hardcode them in this skill.
# Commented examples (do NOT enable unless your project actually needs them):
#   branch.postcreate:
#     - "git submodule update --init --recursive"   # if the spec/protocol is a submodule
#     - "mkdir -p secure-storage"                    # pre-warm a bind-mount dir to dodge a mount race
```

If `branch.postcreate` is empty or absent, there is nothing to run here - say so and continue.

**Install dependencies - functional PRs only.** If the PR touches functional code (source, engine,
scripts), install deps with the configured command (`branch.install_cmd`, default `npm ci`). For a
doc-only PR (only docs, runbooks, READMEs, plans), skip it - the worktree doesn't need it.

```bash
<branch.install_cmd>   # skip for doc-only PRs
```

If a worktree already exists at the target path from a prior PR, ask the user before removing it -
do not auto-clean.

## 4. Load the plan (active slot, then named, then plan mode)

Resolve the plan from `plans.dir` (default `~/.claude/plans`) in this order:

1. **Active slot first:** resolve `plans.active_slot` (default `auto`). When it is set to a path, that
   file is the active slot; when `auto`, fall back to the most-recently-modified plan file in
   `plans.dir` (a named slot beats mtime, since a stray edit can re-stamp the wrong file). Read its
   title line - does it match the PR being started? If yes, use it.
2. **Named PR plan:** a plan file whose name encodes this PR's stage/slug. If one exists and matches,
   prefer it over the active slot.
3. **No matching plan:** propose entering plan mode before any code change. Do NOT proceed without a
   plan for non-trivial work.

If the user named a specific plan file inline, use that and skip the resolution order.

## 5. Ground yourself (automatic)

Invoke the sibling `ground-yourself` skill via the Skill tool, default mode `architecture` (the
four-section grounding). It will write out:

- Global picture (stage, predecessors, successors, the spec section this maps to)
- Blast radius (consumers, which CI gates catch a regression here and which don't)
- Falsifiable success signal (the test, CLI output, CI gate, or artifact that proves it works)
- Systematic + business-logic view

Do this AFTER worktree creation and plan load - by then you have enough context to answer the four
sections honestly. Doing it earlier is grounding-against-empty.

## 6. Surface the ritual list for this PR

State which of the following will apply, based on what the PR touches:

| Ritual | Triggered when |
|---|---|
| **TDD red-green** | adding or changing behavior |
| **design-tests bug catalog** | testing brownfield / untested code |
| **AIV verification packet** | every atomic commit (pre-commit hook enforced) |
| **docstring coverage** | adding or changing exported functions |
| **code-review body read** | every PR - read the automated reviewer's body before merge, never trust a bare "success" status |
| **rebase-merge only** | always - atomic commits land on the base as-is; squash is forbidden |

## 7. Confirm with the user before proceeding

State concisely:

- Worktree: `<path>` (created or reused)
- Branch: `<branch>`
- Plan: `<path>` (or "none - propose plan mode")
- Grounding: complete, or has gaps in [list]
- Rituals applicable: [list]

Then wait for `yes` / `proceed systematically` / a course correction. **Do NOT proceed to code
changes without explicit user confirmation.** The human is the gate; do not optimize the confirmation
away.

## Anti-patterns

- **Skipping memory read** because you "remember from last session." You don't - the session boundary
  is real, memory is the persistence layer.
- **Skipping worktree creation** and working directly in the primary repo. This breaks parallel-work
  isolation.
- **Hardcoding project pre-flight steps in the skill.** Submodule init, bind-mount pre-warming, and
  similar are PROJECT facts - they live in `branch.postcreate`, not in this prose.
- **Assuming a named PR plan file exists.** Check the active slot first; named plans are the exception.
- **Running the install command for a doc-only PR.** Wasted reinstall; the worktree doesn't need it.
- **Diving into code before grounding.** Grounding is 30 seconds; recovering from a misunderstood
  blast radius is hours.
- **Auto-proceeding without confirmation.** The confirmation step is the sanity check. Do not optimize
  it away.

## Principles this skill enforces (universal, not project-specific)

- A skipped mandatory pre-flight step fails *silently* and surfaces far downstream as a wedged build;
  the step itself takes seconds while the eventual diagnosis takes a long time. When you discover such
  a step on a project, encode it in `branch.postcreate` so the next start-pr runs it automatically -
  never re-learn it by re-wedging.
- PRs land via rebase-merge, never squash: atomic commits must reach the base branch as-is so the AIV
  audit trail stays intact.
- A clean / "success" status from an automated reviewer is not the same as no findings - always read
  the review body before treating a PR as mergeable.
- The PASS of this ritual is a *readiness-to-start* signal, not authority to merge. The human is the
  merge gate.
