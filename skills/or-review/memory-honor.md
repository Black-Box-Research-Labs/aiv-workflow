# Memory-honor list - universal principles + host-project lessons

The review cites a short list of discipline rules in the synthesis comment so the implementation
agent can address violations against named rules. The list has two layers:

1. **Universal principles** - always cited, true on any project, stated here as prose. They do not
   depend on any memory file existing.
2. **Project-specific lessons** - pulled at runtime from the **host project's own memory**
   (`memory.dir` / `memory.index` from `.aiv-workflow.yml`). They travel only if the host project
   carries them. If the memory dir is absent or empty, cite only the universal layer and note "no
   project memory found - project-specific lessons skipped."

## Layer 1 - Universal principles (always cite)

These appear in every review's Angle-5 honor audit, regardless of diff signals or which project the
skill runs on:

| Principle | What it means for the reviewer |
|---|---|
| **No autonomous merge** | The reviewer NEVER merges and NEVER approves via `gh pr review --approve`. The human is the merge gate (`merge.autonomous` stays false). Checked on every PR. |
| **Rebase-merge only** | The recommended merge strategy is rebase (`merge.strategy`, default `rebase`); squash is forbidden because atomic commits must land as-is. The reviewer recommends it, never executes it. |
| **Read the CR review body, not just the status** | A passing CI / "success" review status is NOT "no findings." Before any merge recommendation, the latest CodeRabbit (or equivalent) review BODY must be read - `gh pr view <N> --json reviews`. |
| **Check state before acting** | Take no sub-agent claim on faith. The 4a-4d verification step (owned by the `fan-out` skill) exists precisely because "verify before synthesis" gets announced and skipped. Probe every load-bearing claim. |
| **A read-only reviewer never runs the host's full test suite** | Fanning out parallel sub-agents that each launch `vitest` / `playwright` / `npm test` (or the configured `ci.*` commands) would freeze the operator's machine. Verify spec EXISTENCE + STRUCTURE + assertion-to-code alignment; trust the impl agent's local-CI-green claim. |
| **Validate packets through the `aiv` CLI, not by eye** | Packet shape is judged by `<aiv.check_cmd>` (default `aiv check`), whose output the reviewer reads. The reviewer does not restate the spec's header/class rules as its own knowledge. |
| **One comment per round; one-shot** | The reviewer posts exactly one structured comment per round and does not ask the operator "continue?" mid-run. |

## Layer 2 - Project-specific lessons (host memory only)

Inspect the PR file list, then pull the matching lessons from the **host project's own memory**
(`memory.dir`, default `auto` = the project's memory dir; index = `memory.index`, default
`MEMORY.md`). The signal -> topic table below maps a diff file-shape to the KIND of lesson worth
looking up in that memory; the actual rule text and its citation handle come from the host project,
not from this skill.

For each signal whose file-shape matches the diff, grep the host memory index for entries on that
topic and cite any that apply. If the host memory has no entry for a topic, skip it - do not invent a
lesson.

| Diff file-shape | Topic to look up in the host project's memory |
|---|---|
| data-access layer / store (interface + impl + readers/writers) | row-to-object metadata-leak hazards; real-DB vs in-memory test surrogate; DAL-ships-before-consumers completeness |
| subprocess / dispatcher / daemon | wall-clock end-to-end drill required; step-logging at await boundaries; heartbeat / stall-vs-progress detection; sidecar-as-audit dual-write |
| CLI / scripts / installed binary | end-to-end smoke with documented invocation form; installed-binary / symlink target verification |
| migration / RLS | role-bypass probe after RLS cutover; pre-push self-audit for large refactors |
| UI / templated view / browser tests | spec files must not live in the auto-routed pages dir; controlled-clock + foreground tab for polling tests; component-library / CSS version mismatches |
| serverless cron / sessionless API route | wrap data-access calls in the synthetic-session helper |
| verification packets | evidence classes above the mandatory tier floor where they aid the reviewer / rollback; per-packet progress header synced with the commit list |
| CI workflows | runner configuration; repo-wide / org / billing diagnostic before debugging YAML; local-CI replica before push |
| coverage config / large spec batch | write real tests until aggregate coverage rises (don't default to a coverage-exempt escape hatch); when a test fails ask which side is wrong; refactor PRs need behavior-pinning tests |
| plan / design-doc heavy | re-verify migration slot + competing-PR list at every commit boundary; a plan must record its selection rationale; verify cited paths/types against HEAD before treating as authoritative |
| large PR (commits exceed the host's rebase-merge limit) | merge-commit fallback that preserves SHAs (never squash) |
| refactor / extract / rename | behavior-pinning tests required; explicit `key: importedName` mapping inside any type-check-suppressed scope |
| scratch / temp-dir artifacts | the project's scratch-dir handling rules; canonical runbook / drill-script locations |
| worktree / submodule | dedicated worktree for multi-commit branches; submodule init after `git worktree add` |
| container / dev infra | bind-mount race / pre-create-before-mount ordering |

## Skip if not relevant

Don't pad the comment with irrelevant honors. If a signal block above has 0 matching files in the PR
diff, skip its lookups. If the host memory dir is absent, cite only Layer 1.

## How to cite in the comment

In `synthesis-template.md`'s "Memory-honor audit" section, one bullet per cited rule:

```
- <universal principle | host-memory entry handle>: <honored | violation: 1-line evidence>
```

NO long explanations. For a host-memory lesson, the entry's own handle (as the project names it) is
the citation - the operator + impl agent can look it up in their memory. For a universal principle,
the principle name from Layer 1 is the citation.
