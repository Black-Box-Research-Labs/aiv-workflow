# Porting runbook (for agents porting a skill into aiv-workflow)

You are porting ONE Claude Code skill from its black-box-specific form into the portable
`aiv-workflow` plugin. Follow this exactly.

## Read first (the shared contract)

1. `docs/CONVENTIONS.md` (this repo) — the porting rules. Follow them and run its checklist at the end.
2. `config/aiv-workflow.config.example.yml` (this repo) — the config schema. Every project fact you
   need must map to a key here.
3. `skills/prove-it/SKILL.md` (this repo) — the already-ported exemplar. Match its style, structure,
   and the way it references config keys and the `aiv` CLI.

## Source

`/Users/tomriddle1/.claude/skills/<NAME>/` — read `SKILL.md` and EVERY companion file in that dir.

## Verified `aiv` CLI surface (use these exact commands; do NOT invent any)

- `aiv check <file|-|"text">` — validate a verification packet locally. Options: `--diff`,
  `--strict/--no-strict`, `--config`, `--audit-links`. **This is THE validator. There is no
  `aiv guard` CLI command.**
- `aiv init [path]` — AIV-ify a repo: creates `.aiv.yml`, `.github/aiv-packets/`,
  `.github/aiv-evidence/`, installs pre-commit + pre-push hooks.
- `aiv begin <name>` / `aiv commit` — start a tracked change / per-file evidence commit.
- `aiv svp ...` — Sovereign Verification Protocol sub-app (prediction / probe / trace / falsification).
- `aiv quickstart` — print the full workflow.

This plugin's per-project config is `.aiv-workflow.yml` (schema = file #2 above). aiv-protocol's OWN
config is `.aiv.yml` (created by `aiv init`) — do not confuse the two.

## Task

- Write the ported skill to `skills/<NAME>/SKILL.md` (in this repo), and port EACH companion file
  into that same dir.
- Apply CONVENTIONS: no hardcoded absolute paths / repo names / `§`-section numbers / branch strings
  / memory filenames; every project fact via a config key; all AIV substrate operations via the
  `aiv` CLI (read its output, do NOT restate spec rules like CT-001 header strings as skill
  knowledge); universal lessons inlined as principles; remove `[[memory]]` links that only resolve on
  black-box (drop, or convert to a config hook); scrub the frontmatter `description` of project nouns
  (BBRL, black-box, `§15.3`, Greek-letter / γ-lineage PR names, Stage 2x).
- Preserve the methodology, phases, gates, and anti-patterns faithfully. ONLY the bindings change.

## Constraints

- Do NOT edit `config/aiv-workflow.config.example.yml` (multiple agents run concurrently; key
  additions are centralized). If you need a config key missing from the schema, USE it in your skill
  (reference the dotted path with a sensible default) and LIST it in your return.
- Only write files under `skills/<NAME>/`.

## Return (concise — no full-skill paste)

- Config keys used.
- NEW keys you needed (dotted path + purpose + suggested default).
- Any companion file you could not fully genericize, and why.
- Which `[[memory]]` lessons you inlined vs dropped.
