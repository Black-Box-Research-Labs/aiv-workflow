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
| `claude-or-shim.mjs` | `claude -p` drop-in. Parses the CLI flags, runs an OpenRouter function-calling agentic loop, emits the result envelope. Routes each Claude tier through a per-tier **`CASCADE`** of models — free-only by design: free OpenRouter entries, their NVIDIA NIM mirrors, and a local Ollama floor. |
| `bin/claude` | The PATH wrapper. Resolves the shim relative to its own location (portable), sets `NODE_USE_ENV_PROXY=1`, and sets honest `GIT_AUTHOR_*` provenance before exec'ing the shim. |
| `probes/model_probe.mjs`, `probes/model_fix_probe.mjs` | Reproducible vetting harnesses for any new free model (agentic-loop probe + real-code-fix "mini-drive"); each prints a machine-parseable verdict. |
| `../local/Modelfile.qwen3.5-0.8b` | The local lane's shipped Ollama Modelfile (the distillation-target runtime config: 16k `num_ctx` + steadier sampling). See **Local lane** below. |

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

## Local lane (Ollama) — the no-key, no-rate-limit floor

Every tier's cascade ends in a `local:<model>` entry served by a local Ollama, so the cascade can never
hard-stall on quota — and a drive can run **fully local, no API key at all**. Setup:

```bash
# 1. Install Ollama (>= 0.31) and pull a base model
ollama pull qwen3.5:0.8b

# 2. Register the fix-pipeline variant. ../local/Modelfile.qwen3.5-0.8b is the shipped example;
#    the same pattern (FROM <base> + num_ctx 16384 + lowered temperature/top_p) is how the other
#    CASCADE locals (lfm-fixpipe, qcoder-fixpipe) are built from their base models.
ollama create qwen3.5-fixpipe -f orchestration/drivers/local/Modelfile.qwen3.5-0.8b

# 3. Drive local-only (no OPENROUTER_API_KEY needed):
export PATH="$PWD/orchestration/drivers/openrouter/bin:$PATH"
export FIX_MODEL_CASCADE="local:qwen3.5-fixpipe"
export FIX_TEXT_TOOLS=1     # sub-3B models reject the native tools param; drive them via text tool-calls
node orchestration/src/fix_pipeline.mjs --preflight
```

`local:` entries route to `FIX_LOCAL_URL` (default `http://localhost:11434/v1/chat/completions`). The
Modelfile's 16k `num_ctx` is load-bearing, not a tweak: Ollama's ~4k default starves the big fix-pipeline
prompt (finish=length before the model can think + act).

## Shim configuration (env vars)

| Var | Effect |
|---|---|
| `OPENROUTER_API_KEY` / `OPENROUTER_API_KEY_2` | OpenRouter key(s); the second is rotated in on an account-level daily-cap 429. |
| `NVIDIA_API_KEY` | Activates the `nim:` mirror entries (same models, independent quota pool). Unset ⇒ those entries are silently filtered out at startup. |
| `FIX_MODEL_CASCADE` | Comma-separated override of the per-tier cascade — force a single model, go local-only, or opt in to paid insurance. |
| `FIX_TEXT_TOOLS=1` | Text-mode tool-calling for models that reject the native `tools` param (the sub-3B locals). |
| `FIX_LOCAL_URL` | Endpoint for `local:` entries (default Ollama, `http://localhost:11434/v1/chat/completions`). |

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
  the architecture is model-agnostic; the seam makes it configurable.
- **Envelope-parse flakiness (#41):** weaker drivers occasionally wrap the JSON envelope in prose;
  `tolerantJson` handles most cases but not all — a malformed envelope reads as a stage failure.
- **design-tests goal-loop iterations:** a weaker driver may need 2+ attempts to satisfy the
  Class-E/goal gate. That's the loop working as designed (gate rejects → retry), not a ceiling — but it
  costs more turns than Claude does.
- **Subscription-billing default still stands for Claude drives.** OpenRouter is the *only* path that
  uses an API token, and only because the operator explicitly authorized `OPENROUTER_API_KEY` for this
  experiment. Do not route Claude drives through paid API tokens.
