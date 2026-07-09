# Driver swap — running the fix pipeline on a non-Claude model

> Proof-of-concept: the deterministic fix pipeline (`orchestration/src/fix_pipeline.mjs`) is **model-agnostic**.
> Every stage is spawned as `claude -p ...` and gated on a **schema-valid machine block** — never on the
> model's prose or identity. So you can swap the driver behind the `claude` command and the pipeline runs
> unmodified. This directory routes that command to **OpenRouter** (validated end-to-end on `deepseek-v4-pro`).

---

## Why this works without touching the pipeline

The orchestrator spawns its subagents at three sites (`runAgent` preflight, `spawnClaude` back-half,
`spawnOnce` in `runLiveStage` front-half), all of the same shape:

```js
spawn("claude", args, { cwd, env: process.env })
```

with Claude-CLI flags (`-p`, `--model`, `--max-turns`, `--allowedTools`, `--add-dir`,
`--permission-mode`, `--append-system-prompt`, `--output-format json`). The gate then reads a machine
block from a **file the agent Writes** (`extractMachineBlock`) and validates it against a JSON schema.
**The gate decides on the JSON, not on who produced it.** That is exactly what makes the driver
swappable *and* safe: a weaker driver cannot false-pass a gate, it can only fail to produce a valid
block (→ fail-closed HALT). No false "looks done" — convergence still means schema-valid evidence.

So the swap needs **zero pipeline refactor** — just a `claude` executable on PATH that:
- accepts the same flags,
- runs an agentic tool loop (Bash/Read/Write/Glob/Grep), and
- emits the same `{type:"result", subtype, is_error, result, ...}` envelope `tolerantJson` parses.

That's what `claude-or-shim.mjs` is.

## Files here

| File | Role |
|---|---|
| `claude-or-shim.mjs` | `claude -p` drop-in. Parses the CLI flags, runs an OpenRouter function-calling agentic loop, emits the result envelope. Routes each Claude tier through a per-tier **`CASCADE`** of OpenRouter models (free-first, with a cheap paid gpt-oss as rate-limit/402 insurance). |
| `bin/claude` | The PATH wrapper. Resolves the shim relative to its own location (portable), sets `NODE_USE_ENV_PROXY=1`, and sets honest `GIT_AUTHOR_*` provenance before exec'ing the shim. |
| `model_probe.mjs`, `model_fix_probe.mjs` | Reproducible vetting harnesses for any new free model (agentic-loop probe + real-code-fix "mini-drive"). See `EVAL_2026-06-24.md`. |

## Model cascade (rate-limit / 402 insurance)

`callModel` routes each tier through an ordered **`CASCADE`** and advances to the next entry on
**429 / 402 / 5xx** (sticky — never falls back to an earlier, more-rate-limited model). **Free-only by
design** — when a free model rate-limits, fall to *another free model* (different provider), never to a
paid one. If the whole free cascade is exhausted, `callModel` throws → the pipeline HALTs fail-closed →
the supervisor resumes from the atomic cursor once the daily free limit resets. Paying to avoid a stall
isn't worth it (and reintroduces the 402 credit wall we left deepseek to escape).

```
opus (gate):   nemotron-3-ultra → nemotron-3-super → north-mini-code → gpt-oss-120b → gpt-oss-20b → local
sonnet (exec): (same strongest-free-first shape, its own ranking)
haiku (cheap): a shorter free chain, same shape
```

Each OpenRouter `:free` entry is followed by its **NVIDIA NIM mirror** (identical model, independent quota
pool), and every tier ends in a **local Ollama model** so the cascade never hard-stalls. The exact per-tier
lists are the `CASCADE` constant in `claude-or-shim.mjs` — that is the source of truth. Want paid insurance
for a single time-critical drive? Opt in **explicitly** per-run:
`FIX_MODEL_CASCADE="openai/gpt-oss-120b:free,openai/gpt-oss-120b"`. The free cascade is $0.

## Usage

```bash
export OPENROUTER_API_KEY=sk-or-...           # the driver's key (this is the ONE place tokens are used)
export PATH="$PWD/orchestration/drivers/openrouter/bin:$PATH"   # shadow the real `claude`
which claude                                   # -> .../drivers/openrouter/bin/claude

# from here, the pipeline is driven entirely by the OpenRouter model:
node orchestration/src/fix_pipeline.mjs --preflight        # cheap real call — proves auth + tool-use + handoff
node orchestration/src/fix_pipeline.mjs --intake --finding-id <ID> --repo <O/R> ...
SPEC=...; bash orchestration/src/drive_supervisor.sh "$SPEC" /tmp/drive.log
```

To target a different OpenRouter model, edit `MODEL_MAP` in `claude-or-shim.mjs` and the
`FIX_DRIVER_GIT_NAME`/`FIX_DRIVER_GIT_EMAIL` (or the defaults in `bin/claude`) so commit provenance
stays honest.

## Two non-obvious requirements (both baked into `bin/claude`)

1. **`NODE_USE_ENV_PROXY=1`.** Node's global `fetch` ignores `HTTPS_PROXY` unless this is set (Node 22
   honors it). Without it, every OpenRouter call fails `403 "Host not in allowlist: openrouter.ai"`
   behind the agent proxy. (`spawnSync curl` would route fine; `fetch` will not — this bit us first.)

2. **Honest provenance (`GIT_AUTHOR_*`).** The sandbox's *global* git identity is
   `Claude <noreply@anthropic.com>`, so a deepseek-driven commit would inherit "Claude" as author — a
   false AIV Class-F provenance claim. The wrapper overrides `GIT_AUTHOR_*`/`GIT_COMMITTER_*` so the
   commit author reflects the **actual** driver. The shim *also* injects an identity line into the
   system prompt ("You are `<model>` … never claim to be Claude … honest provenance is mandatory") so
   the model doesn't self-label "Claude" inside AIV packet fields (`classified_by`, evidence author).

## Resilience built into the shim

- **In-shim network retry** (`callModel`, 4 attempts, exp backoff) on `429/408/5xx` and network errors
  (`fetch failed|terminated|econnreset|socket|timeout|…`). A dropped connection mid-stage retries inside
  the shim instead of forcing the pipeline to re-spawn the whole agent.
- **Retryable-vs-fatal classifier** on the run() catch: only `429/408/5xx`/network/timeout strings are
  surfaced as "temporary (retryable)" so the pipeline's transient-retry path fires; a `400 bad-model`
  fails fast instead of burning retries.
- **Glob injection guard** (#49): shell metachars stripped from the pattern; glob chars kept.

## Validated result (end-to-end eval)

`deepseek-v4-pro` (via this shim) drove **flashcore F354** through the full spine — check-drift (GATE
PASS on a schema-valid verdict block), ground (venv), design-tests, write-code, prove-it (SEAM RED→GREEN),
open-PR (**#51**), aiv-audit (COMPLIANT) — and got **CI fully green (13/13**, including the strict
`validate-packet` gate and `tests_mac`). It survived a container restart by resuming from the atomic
cursor, then continued into the back-half (cr-review). **The safety thesis held:** when deepseek
produced an incomplete AIV packet, the gate **rejected** it (no false-pass) and the goal-loop
self-corrected on the next attempt.

## Known caveats / where the seams are

- **This is a PoC swap, not the production seam.** The clean productionization is a `spawnAgent()`
  function in `fix_pipeline.mjs` that tiers the backend **per stage** (e.g. keep opus on the high-stakes
  gates, route exec/preflight to a cheaper driver) instead of a global PATH shadow. The PATH shim proves
  the architecture is model-agnostic; the seam makes it configurable. (Tracked in `CI_TODO.md`.)
- **Envelope-parse flakiness (#41):** weaker drivers occasionally wrap the JSON envelope in prose;
  `tolerantJson` handles most cases but not all — a malformed envelope reads as a stage failure.
- **design-tests goal-loop iterations:** a weaker driver may need 2+ attempts to satisfy the
  Class-E/goal gate. That's the loop working as designed (gate rejects → retry), not a ceiling — but it
  costs more turns than Claude does.
- **Subscription-billing default still stands for Claude drives.** OpenRouter is the *only* path that
  uses an API token, and only because the operator explicitly authorized `OPENROUTER_API_KEY` for this
  experiment. Do not route Claude drives through paid API tokens.
