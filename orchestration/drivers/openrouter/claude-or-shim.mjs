#!/usr/bin/env node
/**
 * claude → OpenRouter agentic shim (test harness for the fix-pipeline driver swap)
 * Drop-in replacement for `claude -p` that runs an agentic tool loop over OpenRouter.
 * Required env: OPENROUTER_API_KEY
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argsIn = process.argv.slice(2);
const getVal = (flag) => { const i = argsIn.indexOf(flag); return i >= 0 && i + 1 < argsIn.length ? argsIn[i + 1] : null; };
const getAllVals = (flag) => { const v = []; for (let i = 0; i < argsIn.length; i++) if (argsIn[i] === flag && i + 1 < argsIn.length) v.push(argsIn[i + 1]); return v; };

const promptArg = getVal("-p") ?? getVal("--print") ?? getVal("--prompt") ?? "";
const rawModel = getVal("--model") || "sonnet";
const sysPrompt = getVal("--append-system-prompt") || "";
const maxTurns = parseInt(getVal("--max-turns") || "60", 10);
const addDirs = getAllVals("--add-dir");

let prompt = promptArg;
if (promptArg && existsSync(promptArg) && statSync(promptArg).size > 0) {
  try { prompt = readFileSync(promptArg, "utf8"); } catch {}
}

// ── FULL-FIDELITY TURN TRACE (observability; env-gated via FIX_SHIM_TRACE, off by default, non-fatal) ──
// When FIX_SHIM_TRACE points at a file, append ONE JSON line per model turn: the NEW context the model saw,
// its raw assistant message (content + reasoning + tool_calls), token usage, latency, and every tool exec
// with UNTRUNCATED args + results. This is the "what is the free model actually doing, and why" record the
// truncated stderr [tool] lines can't give. Best-effort — a trace write must NEVER break a drive.
const STAGE = (String(prompt).match(/#\s*Fix-pipeline stage:\s*(\S+)/) || [, null])[1];
function trace(rec) {
  const p = process.env.FIX_SHIM_TRACE;
  if (!p) return;
  try { appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, stage: STAGE, ...rec }) + "\n"); } catch { /* observability never breaks a drive */ }
}

// Per-tier fallback CASCADE — ranked by the empirical should-use eval (2026-06-24): real-code-fix
// pass-rate, reliability-under-load, provider fan-out, privacy. **FREE-ONLY by design** — the whole
// point is a $0 audit loop. When a free model rate-limits, fall to ANOTHER FREE model (different
// provider), never to a paid one. If the entire free cascade is exhausted, callModel throws and the
// pipeline HALTs fail-closed — the supervisor resumes from the atomic cursor once the daily free
// limit resets. Paying to avoid a stall is NOT worth it (and reintroduces the 402 credit wall we left
// deepseek to escape). Higher tiers also gain context-length headroom down-chain (super = 1M ctx) for
// the big aiv-audit/cr-review prompts. Want paid insurance for a time-critical drive? Opt in
// explicitly per-run: FIX_MODEL_CASCADE="openai/gpt-oss-120b:free,openai/gpt-oss-120b".
// #114: each tier ends with `openai/gpt-oss-20b:free` as a LAST-RESORT free fallback (NOT a reorder — it sits
// BELOW every quality coder). When the strong coders are all daily-capped (cooldown-skipped), this keeps a free
// model available so a drive never hard-stalls; it yields the lead back the instant a better coder's cooldown lapses.
const CASCADE = {
  // #115: nemotron-3-super leads both gate and exec tiers. gpt-oss-120b led previously but was only ever
  // justified against gpt-oss-20b (e845b21: "20b narrated launch-brief as text; 120b doesn't"). nemotron-3-super
  // was never compared to 120b for exec tasks (JSON production, structured output, cr-review agent) — it ended
  // up 2nd/3rd by default from the initial cascade, not from evidence. gpt-oss-120b is documented as
  // "general/reasoning, weakest coder" (~62% SWE-bench); nemotron-3-super is a substantially stronger model.
  // The cr-review `open=?` JSON parse failures on F140 (gpt-oss-120b leading exec) are the observable cost of
  // the wrong ordering. Apply the same principle as #92: strongest model leads; cascade down on rate-limit.
  // #116: nemotron-3-ultra added as new exec+gate lead. Probe (2026-06-25) at production 8192t: fastest clean
  // JSON at 5.3s/199t (reasoning internal, hidden; visible output is clean). Was excluded from code tier (#88)
  // for reasoning-heavy code generation, NOT for structured output tasks. Both super and 20b confirmed at 8192t.
  // #117: NVIDIA NIM mirrors interleaved per model (nim: prefix -> integrate.api.nvidia.com, NVIDIA_API_KEY).
  // OBSERVED (2026-07-05): the walk hard-parked when OpenRouter's ACCOUNT-level free budget (1000 req/day
  // shared across ALL :free models) hit 0 — a limit NO amount of OR-side fallback can route around. NIM serves
  // the SAME models on NVIDIA's own per-key limits (verified live: nemotron-3-ultra answered while every OR
  // :free request 429'd), so each OR entry is followed by its NIM mirror: identical quality rank, independent
  // quota pool. Entries whose provider key is unset are filtered out at startup (inert without NVIDIA_API_KEY).
  // #181 (ARCHITECTURAL — the missing floor): every cloud tier ends in a LOCAL model (Ollama :11434, the #128
  // lane — always-up, no rate limit, no congestion). WITHOUT this the cascade floor was another :free CLOUD
  // model, so when the WHOLE free cloud tier saturated (OR :free 429 is upstream-SHARED across both accounts +
  // NIM overloaded), the walk exhausted and the drive HALTed — with the entire 1B fleet (qcoder/lfm/minicpm5,
  // the campaign fleet) sitting idle on this machine. Local is the ultimate fail-safe: cloud -> NIM -> LOCAL,
  // never a hard stall. Reached ONLY when every cloud entry is cooled/exhausted (a healthy drive never touches
  // it). Judges (opus) -> lfm; exec (sonnet) + coders (code) -> qcoder. CAVEAT: a 1B local model needs
  // FIX_HARNESS_CEREMONY=all + the prefills to do the WIDE judge stages — the paired driver-side coupling
  // (auto-switch ceremony when a stage actually falls through to local) makes judges viable on local; exec
  // stages already complete under `build` ceremony (campaign-proven). Even without the coupling, a degraded
  // local attempt + the recovery mechanisms (#176/#125) beats a HALT.
  opus:   ["nvidia/nemotron-3-ultra-550b-a55b:free", "nim:nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b:free", "nim:nvidia/nemotron-3-super-120b-a12b", "cohere/north-mini-code:free", "openai/gpt-oss-120b:free", "nim:openai/gpt-oss-120b", "openai/gpt-oss-20b:free", "nim:openai/gpt-oss-20b", "local:lfm-fixpipe"],
  // exec: ultra leads (fastest clean JSON for gate/cr-review/aiv-audit), super fallback (1M ctx), 120b/20b last, then LOCAL floor (#181).
  sonnet: ["nvidia/nemotron-3-ultra-550b-a55b:free", "nim:nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b:free", "nim:nvidia/nemotron-3-super-120b-a12b", "openai/gpt-oss-120b:free", "nim:openai/gpt-oss-120b", "openai/gpt-oss-20b:free", "nim:openai/gpt-oss-20b", "local:qcoder-fixpipe"],
  haiku:  ["nvidia/nemotron-3-nano-30b-a3b:free", "nim:nvidia/nemotron-3-nano-30b-a3b", "openai/gpt-oss-20b:free", "nim:openai/gpt-oss-20b", "local:qwen3.5-fixpipe"],
  // #81: a dedicated CODE tier for the implementation stage (write-code). The gpt-oss authoring models drove
  // plan/design/review fine but produced BROKEN code at write-code (gutted production files, prose+unicode in
  // .py files, duplicate tests). Route write-code to the strongest free CODING specialists instead: Laguna M.1
  // (72.5% SWE-bench) → Nemotron-3-Ultra (~71.9%, 1M ctx) → gpt-oss-120b fallback. Pipeline opts in by passing
  // --model code for the write-code stage (FIX_MODEL_CODE=code). NOTE: Laguna's FREE tier may train on inputs —
  // an accepted tradeoff for code quality on this track; swap to a paid/no-log coder for sensitive repos.
  // #92: STRONGEST-CODER-first, grounded in BOTH external SWE-bench Verified AND live free-endpoint tests
  // (capability ranking != usable ranking — you need both). design-tests AND write-code share this `code`
  // tier (#82) and need a real CODING model, not a general one. gpt-oss-120b (general/reasoning, weakest
  // coder here) SYSTEMATICALLY FAILED both stages on the free drives — guts/renames public symbols at
  // write-code (F170 ImportError) and churns without a valid packet at design-tests (F140/F83).
  //   model                  SWE-bench Verified   live free-endpoint (2026-06-25)
  //   poolside/laguna-m.1     72.5% (225B/23B)     BROKEN: 600s, finish=error, 0 content -> EXCLUDED
  //   qwen3-coder:free        69.6% (480B/35B)     429 rate-limited (0/6) -> as primary a 429 sticky-
  //                                                advances ~0.5s, capturing it whenever it IS free
  //   poolside/laguna-xs.2    68.2% (33B/3B)       6/6 usable, 5/6 surgical, tools=true -> THE WORKHORSE
  //                                                (slow 10-27s/call but reliable+surgical beats fast-fail
  //                                                behind a fail-closed gate)
  //   gpt-oss-120b:free       ~62% (general)       reliable but weakest -> last-resort fallback only
  // #117: code tier gains NIM mirrors ONLY for models already ranked here (gpt-oss); NIM's other coders
  // (qwen3.5, deepseek-v4-flash) are NOT mirrors of ranked entries and stay out until probed per #92
  // (capability ranking != usable ranking — never add an unranked coder just because an endpoint exists).
  code:   ["qwen/qwen3-coder:free", "poolside/laguna-xs.2:free", "openai/gpt-oss-120b:free", "nim:openai/gpt-oss-120b", "openai/gpt-oss-20b:free", "nim:openai/gpt-oss-20b", "local:qcoder-fixpipe"],   // #181: LOCAL coder floor
};
// #117: provider registry + entry resolver (pure, selftested). A cascade entry is either a bare OpenRouter
// model id ("vendor/model:free" — note ':free' is a MODEL suffix, not a provider prefix) or "nim:<model-id>"
// for NVIDIA NIM's OpenAI-compatible endpoint. Keys per provider; OR supports a second account key
// (OPENROUTER_API_KEY_2) rotated on the account-level daily cap — see the 429 branch in callModel.
const orKeys = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_2].filter(Boolean);
let orKeyIdx = 0;
// #128: LOCAL lane — an OpenAI-compatible endpoint on this machine (Ollama/llama.cpp/LM Studio/MLX), for the
// state-of-the-art sub-1B models that NO hosted provider serves (Qwen3.5-0.8B et al. run only as local weights).
// `local:<model>` -> FIX_LOCAL_URL (default Ollama's :11434/v1). No API key (key()="local" so it's never
// filtered as keyless). These models don't do native function-calling, so pair with FIX_TEXT_TOOLS=1.
const LOCAL_URL = process.env.FIX_LOCAL_URL || "http://localhost:11434/v1/chat/completions";
const PROVIDERS = {
  or:    { id: "or",    label: "OpenRouter",  url: "https://openrouter.ai/api/v1/chat/completions",        key: () => orKeys[orKeyIdx] },
  nim:   { id: "nim",   label: "NVIDIA NIM",  url: "https://integrate.api.nvidia.com/v1/chat/completions", key: () => process.env.NVIDIA_API_KEY },
  local: { id: "local", label: "local",       url: LOCAL_URL,                                              key: () => "local" },
};
function resolveEntry(entry) {
  if (entry.startsWith("nim:"))   return { prov: PROVIDERS.nim,   model: entry.slice(4) };
  if (entry.startsWith("local:")) return { prov: PROVIDERS.local, model: entry.slice(6) };
  return { prov: PROVIDERS.or, model: entry };
}
const tier = (rawModel.toLowerCase().match(/haiku|sonnet|opus|code/) || ["sonnet"])[0];
const rawCascade = (process.env.FIX_MODEL_CASCADE ? process.env.FIX_MODEL_CASCADE.split(",").map((s) => s.trim()).filter(Boolean) : null) || CASCADE[tier] || CASCADE.sonnet;

// #114: RATE-LIMIT COOLDOWN. The tiers are quality-ranked (strongest free coder first) and must STAY that way —
// reordering them to chase availability ships a weaker model when the good one is merely DAILY-capped. Instead,
// DETECT a daily rate-limit (HTTP 429 `limit_rpd` / `free-models-per-day` / "requests per day") and TEMPORARILY
// remove that model from the cascade for a few hours, persisted to a SHARED file so EVERY shim invocation (the
// shim is a fresh process per stage spawn, across all concurrent drives) skips it without re-probing — no wasted
// 429 round-trips, and the moment the cooldown lapses the strong coder retakes its rightful lead automatically.
const RL_FILE = process.env.OR_RL_COOLDOWN_FILE || "/tmp/or-rl-cooldown.json";
const RL_COOLDOWN_MS = parseInt(process.env.OR_RL_COOLDOWN_MS || String(3 * 3600 * 1000), 10);   // daily-cap → skip ~3h, then re-probe
const HANG_COOLDOWN_MS = parseInt(process.env.OR_HANG_COOLDOWN_MS || String(10 * 60 * 1000), 10); // #179: hung/overloaded endpoint → skip ~10min, then re-probe (de-congestion self-heals)
function loadCooldowns() { try { return JSON.parse(readFileSync(RL_FILE, "utf8")) || {}; } catch { return {}; } }
function isCooled(mdl) { return (loadCooldowns()[mdl] || 0) > Date.now(); }
function recordCooldown(mdl, ms, reason = "daily cap") { try { const c = loadCooldowns(); c[mdl] = Date.now() + ms; writeFileSync(RL_FILE, JSON.stringify(c)); console.error(`[shim] cooldown: ${mdl} removed from cascade for ${Math.round(ms / 60000)}min (${reason})`); } catch {} }
// effective cascade = quality order MINUS models currently cooling down. If EVERY entry is cooled, fall back to
// the full list (re-probe — better to try than to hard-fail; a lapsed/transient cooldown self-heals on success).
// #117: drop entries whose provider has no key configured (e.g. nim: mirrors without NVIDIA_API_KEY) so the
// walker never wastes a round-trip on a guaranteed 401 — the mirrors are INERT until the key lands in .env.
const keyedCascade = rawCascade.filter((m) => !!resolveEntry(m).prov.key());
const liveCascade = keyedCascade.filter((m) => !isCooled(m));
const cascade = liveCascade.length ? liveCascade : keyedCascade;
if (liveCascade.length < rawCascade.length) console.error(`[shim] tier '${tier}' active cascade (cooled/keyless skipped): ${cascade.join(", ")}`);
let activeIdx = 0;
const activeModel = () => resolveEntry(cascade[Math.min(activeIdx, cascade.length - 1)]).model;

const API_KEY = process.env.OPENROUTER_API_KEY;
// #87: per-request wall-clock cap. Bounds a hung/overloaded free-model connection so the AbortController fires
// and the cascade advances (line ~486, catch: transient->advance immediately, no 4x retry on the same dead
// socket) instead of blocking the whole stage.
// #178: default 5min -> 3min. OBSERVED (F004 aiv-audit emission, live): after #177 made exploration fast (~5min
// documentary reads), the agent's verdict-emission request HUNG on an overloaded nemotron endpoint (shim STAT=S,
// 0% CPU, no child, 10min+). The catch advances per hang, but at 5min/entry × the nemotron cascade prefix
// (ultra:free, nim:ultra, super:free, nim:super) that is ~20min of dead-socket waiting before reaching a
// responsive model — the new dominant sink. A HUNG connection (no response body) never self-heals, so detecting
// it in 3min vs 5min routes around ~40% faster with margin to spare (a legit gate-verdict / tool-call turn
// completes in well under a minute; the #88 "spends MINUTES then returns garbage" case is aborted sooner, which
// is correct — that output was unusable anyway). Env-tunable (OR_REQ_TIMEOUT_MS) for a slower link.
const REQ_TIMEOUT_MS = parseInt(process.env.OR_REQ_TIMEOUT_MS || "180000", 10);
// #175: output budget + continuation bound. 8192 was a probe default (#116) that TRUNCATES a thorough gate
// audit (check-drift/or-review/aiv-audit) before its trailing machine-readable verdict block — the pipeline
// then sees no block, mislabels the truncation an "outage", and re-spawns into an identical re-truncation
// until it HALTs (observed: F004 check-drift, t#7 finish=length at ctok=8192, the R-tier audit cut mid-'Audit
// depth' before the block). Raise the per-request ceiling AND stitch continuations (continueText) so a longer-
// than-budget audit still completes. Both env-tunable.
const MAX_TOKENS = parseInt(process.env.FIX_MAX_TOKENS || "16384", 10);
const CONT_MAX = parseInt(process.env.FIX_CONT_MAX || "4", 10);
// #128a: only OpenRouter entries need OPENROUTER_API_KEY — a local-only or NIM-only cascade must not be blocked
// by its absence (a local Qwen3.5-0.8B drive needs no OR key at all). Require it only if the active cascade
// actually contains an OR-lane entry.
const cascadeNeedsOrKey = cascade.some((m) => resolveEntry(m).prov.id === "or");
if (!API_KEY && cascadeNeedsOrKey) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "OPENROUTER_API_KEY not set (required for the OpenRouter entries in this cascade)" }));
  process.exit(1);
}

const TOOLS = [
  { type: "function", function: { name: "Bash", description: "Run a bash command in the cwd. Returns stdout+stderr.", parameters: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number" } }, required: ["command"] } } },
  { type: "function", function: { name: "Read", description: "Read a file.", parameters: { type: "object", properties: { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["file_path"] } } },
  { type: "function", function: { name: "Write", description: "Write content to a file.", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
  // #120: surgical single-site editing. OBSERVED (F017 write-code v1 t7): the stage task says "prefer the Edit
  // tool over rewriting a whole file" but this shim had NO Edit tool — the model whole-file-rewrote a 1-line
  // constant fix and corrupted an unrelated function (the exact EXP-1/F170 failure class the instruction warns
  // about; self-recovered only by luck+git). Give weak models the surgical primitive the contract promises.
  { type: "function", function: { name: "Edit", description: "Replace an exact string in a file (surgical edit — preferred over rewriting whole files). old_string must match exactly and uniquely unless replace_all.", parameters: { type: "object", properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["file_path", "old_string", "new_string"] } } },
  { type: "function", function: { name: "Glob", description: "Find files matching a glob.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "Grep", description: "Search for a pattern in files.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, recursive: { type: "boolean" }, output_mode: { type: "string", enum: ["content", "files", "count"] } }, required: ["pattern", "path"] } } },
];

const cwd = process.cwd();

// #127: TEXT-TOOL mode — drive models that do NOT support native OpenAI function-calling (sub-3B: llama-3.2-1b,
// gemma-2b, LFM2) by describing the tools in the prompt and PARSING tool calls out of the text response. The
// endpoints for these models reject the `tools` param outright ("No endpoints found that support tool use" /
// "extra_forbidden"), but the models CAN emit a parseable call given a format + one-shot (verified live:
// llama-3.2-1b -> `<tool_call>{"name":"Bash","arguments":{"command":"cat …"}}</tool_call>`). Enabled by
// FIX_TEXT_TOOLS=1 or auto for a known sub-tool-calling model id. Reuses the same execTool/repairToolArgs path.
const TEXT_TOOLS = process.env.FIX_TEXT_TOOLS === "1" || /llama-3\.2-1b|gemma-2b|gemma-2-2b|lfm-2/i.test(rawModel);
function toolTextPreamble() {
  const sigs = TOOLS.map((t) => { const p = t.function.parameters.properties; const req = t.function.parameters.required || [];
    return `- ${t.function.name}(${Object.keys(p).map((k) => req.includes(k) ? k : `${k}?`).join(", ")}) — ${t.function.description}`; }).join("\n");
  return `\n\nTOOL PROTOCOL (this endpoint has NO native tool API — you MUST use this text format): to call a tool, output a line EXACTLY:\n<tool_call>{"name":"<ToolName>","arguments":{...}}</tool_call>\nEmit one or more such lines and STOP; the results come back as a USER message prefixed "TOOL RESULT". NEVER write "TOOL RESULT" yourself — only the harness writes results, AFTER it runs your call; a message you write containing "TOOL RESULT" is a hallucination and does nothing. Only when the whole task is DONE, reply with plain text and NO <tool_call>. Tools:\n${sigs}\nExample: <tool_call>{"name":"Read","arguments":{"file_path":"src/x.py"}}</tool_call>`;
}
// parse <tool_call>{...}</tool_call> blocks (and a bare {"name":…,"arguments":…} fallback) into the native
// tool_calls shape the run loop already consumes. PURE, selftested.
function parseTextToolCalls(content) {
  const out = [], s = String(content || "");
  // #148 (prevention half): only accept KNOWN tool names — the widened scans below would otherwise swallow a
  // legitimate data JSON (e.g. a machine block) that happens to carry a "name" field.
  const KNOWN = new Set(["Bash", "Read", "Write", "Edit", "Grep", "Glob"]);
  const push = (js, i) => { try { const o = JSON.parse(js); if (o && o.name && KNOWN.has(String(o.name))) { out.push({ id: `txt_${i}`, function: { name: o.name, arguments: JSON.stringify(o.arguments || o.args || {}) } }); return true; } } catch {} return false; };
  let m, re = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g, i = 0;
  while ((m = re.exec(s))) push(m[1], i++);
  // #148 (prevention): 1B models under FIX_TEXT_TOOLS emit NEAR-MISS formats the strict tag regex rejects — the
  // F017 design-tests traces show qcoder putting {"name":"Write","arguments":{...}} inside ```json fences on 43
  // turns (0 parsed → the run ended as narration → every 1B "couldn't tool-call" at this stage). The model IS
  // calling tools; the parser was the wall. Accept (a) fenced ```json blocks and (b) bare balanced {...} spans,
  // each individually parsed + KNOWN-name-filtered — replacing the old single outermost-brace slice, which died
  // whenever the text held >1 JSON object or stray braces.
  if (!out.length) { const fence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g; while ((m = fence.exec(s))) push(m[1], i++); }
  // #150b: a model stuck in fake-result mode ("TOOL RESULT (Bash):\n```bash\n<cmd>```" — seed-parroting, observed
  // qcoder run 35) still states an unambiguous intent: the tool name AND the command are right there. Execute the
  // call it plainly contains instead of reprompt-looping — the REAL result then lands in context and corrects the
  // roleplay. Bash-with-fenced-command only (the one unambiguous form); Write/Edit fake-results stay unparsed
  // (their args aren't reliably recoverable) and fall through to the #148 reprompt.
  if (!out.length) {
    const fr = /TOOL RESULT \(Bash\):?\s*```(?:bash|sh)?\s*\n?([\s\S]*?)```/g;
    while ((m = fr.exec(s))) { const cmd = m[1].trim(); if (cmd && !/^#/.test(cmd)) out.push({ id: `txt_${i++}`, function: { name: "Bash", arguments: JSON.stringify({ command: cmd }) } }); }
  }
  if (!out.length && /"name"\s*:/.test(s)) {
    for (let a = s.indexOf("{"); a >= 0 && out.length < 8; a = s.indexOf("{", a + 1)) {
      let depth = 0, b = a;
      for (; b < s.length; b++) { if (s[b] === "{") depth++; else if (s[b] === "}") { depth--; if (!depth) break; } }
      if (depth === 0 && b > a && push(s.slice(a, b + 1), i)) { i++; a = b; }
    }
  }
  return out;
}

// ── PATH CONFINEMENT (defense-in-depth): the structured file tools (Read/Write/Glob/Grep) may only touch paths
// under an ALLOWED ROOT — the cwd or an --add-dir. Real `claude -p` sandboxes to --add-dir; this shim did NOT,
// so a weak model reading ABSOLUTE paths reached other sessions' scratch AND the operator's MEMORY backup
// (observed live on F017 launch-brief). Confine the file tools here. Bash stays powerful — real tooling (venv,
// git, aiv, python) needs it and safely sandboxing arbitrary bash in-process is not possible; that is the fleet
// sandbox's job. A bash command that references a path outside the workspace is LOGGED (observability), not blocked.
const ALLOWED_ROOTS = [cwd, ...addDirs].filter(Boolean).map((d) => resolve(d));
function withinAllowed(p) { const r = resolve(cwd, String(p ?? "")); return ALLOWED_ROOTS.some((root) => r === root || r.startsWith(root + "/")); }
// #133 (recovery): repair the STRAY-LEADING-SLASH path — a weak model that knows the relative structure but
// prepends '/' emits '/src/foo.py' or '/.venv/bin/python' (absolute -> confinement-rejected) when it MEANT the
// worktree-relative path. OBSERVED (qwen3.5:0.8b verify-finding: 17 OUTSIDE errors, many were exactly this).
// If the given path is outside the roots BUT its slash-stripped form resolves INSIDE a root, remap to that
// (only when it EXISTS, so we never invent a target). Returns {path, repaired} or {path:null} for a true escape.
function confinePath(p) {
  const r = resolve(cwd, String(p ?? ""));
  if (withinAllowed(r)) return { path: r, repaired: false };
  if (typeof p === "string" && p.startsWith("/")) {
    const rel = resolve(cwd, p.replace(/^\/+/, ""));
    if (withinAllowed(rel) && existsSync(rel)) { process.stderr.write(`[path-repair] '${p}' -> worktree-relative '${p.replace(/^\/+/, "")}'\n`); return { path: rel, repaired: true }; }
  }
  return { path: null, repaired: false };
}
// #131 (recovery): the confinement error must GUIDE a weak model back on-path, not just reject — observed a
// 0.8B model burn ~20 turns re-issuing absolute /private/... paths and chasing the finding-file. Tell it the
// concrete fix (use a RELATIVE path; the finding/assets are inline) so the deterministic error bounds the flail.
const OUTSIDE_MSG = (p) => `ERROR: '${p}' is OUTSIDE the allowed workspace roots. FIX: use a path RELATIVE to your current directory (e.g. 'src/foo.py', NOT an absolute '/private/...' path). The FINDING and any skill assets are already INLINED in your prompt — do NOT open them from files. Re-issue your call with a relative path under the worktree.`;

// #101: tool-INPUT repair layer (validate-then-repair — the schema is the prior; only repair where the model's
// args disagree, never touch valid input). Free models hit a small finite set of tool-call arg quirks; repair
// them at the harness boundary instead of failing the call or silently no-op'ing (the old `catch -> {}`).
// Observed LIVE on our drives: gpt-oss emitting Bash({}) (empty) and Write({path}) where our schema wants
// file_path (our own Grep/Write key inconsistency leaking through). SCHEMA-AWARE: a synonym key is remapped to
// the canonical key ONLY when the canonical is in THIS tool's schema and the provided key is not — so Grep's
// legitimate `path` (a search dir) is never rewritten. (Pattern credit: CommandCode tool-input-repair; the
// harness mediates between the model's distribution and our contract.)
const TOOLMAP = Object.fromEntries(TOOLS.map((t) => [t.function.name, { keys: Object.keys(t.function.parameters.properties), required: t.function.parameters.required || [] }]));
const SYNONYMS = { file_path: ["path", "filepath", "file", "filename", "file_name", "target", "output_path", "filepath_"], content: ["text", "data", "body", "contents", "code"], command: ["cmd", "bash", "script", "shell"], pattern: ["query", "regex", "search", "glob", "expression"] };
function unwrapMdLink(v) { if (typeof v !== "string") return v; const m = v.match(/^\s*\[([^\]]+)\]\((?:https?:\/\/)?([^)]+)\)\s*$/); return (m && m[1].trim() === m[2].replace(/^https?:\/\//, "").trim()) ? m[1].trim() : v; }
function repairToolArgs(name, args) {
  const meta = TOOLMAP[name]; if (!meta || !args || typeof args !== "object") return { args: args || {}, repairs: [] };
  const repairs = [], out = {};
  for (let [k, v] of Object.entries(args)) {
    if (!meta.keys.includes(k)) {                                        // (1) key-synonym remap, schema-aware
      for (const [canon, alts] of Object.entries(SYNONYMS)) {
        if (meta.keys.includes(canon) && !(canon in args) && alts.includes(String(k).toLowerCase())) { repairs.push(`${k}->${canon}`); k = canon; break; }
      }
    }
    if (Array.isArray(v) && v.length === 1 && typeof v[0] === "string") { v = v[0]; repairs.push(`${k}:unwrap-1elem-array`); }   // (2) ["x"] -> "x"
    if (typeof v === "string") { const u = unwrapMdLink(v); if (u !== v) { v = u; repairs.push(`${k}:unwrap-mdlink`); } }          // (3) "[x](http://x)" -> "x"
    if (v === null && !meta.required.includes(k)) { repairs.push(`${k}:drop-null`); continue; }                                    // (4) null on optional -> omit
    out[k] = v;
  }
  return { args: out, repairs };
}
function requiredMissing(name, args) { const meta = TOOLMAP[name]; if (!meta) return []; return meta.required.filter((r) => args[r] === undefined || args[r] === null || args[r] === ""); }
function execTool(name, args) {
  try {
    if (name === "Bash") {
      // observability-only (not a block — bash runs real tooling): surface any workspace-escaping path so
      // cross-session scavenging stays VISIBLE even though the real boundary is the fleet sandbox, not this shim.
      const esc = (String(args.command || "").match(/\/(?:private\/tmp\/claude[-\w]*|Users)\/[^\s'";|&)]+/g) || []).filter((p) => !withinAllowed(p));
      if (esc.length) process.stderr.write(`[confine-warn] Bash references path(s) outside the workspace (not blocked; fleet sandbox is the real boundary): ${esc.slice(0, 2).join(" ")}\n`);
      // `aiv commit`/`aiv close` collect Class A/D evidence by RUNNING the full test+lint suite — MINUTES per
      // commit. The 120s default SIGKILLs them (ETIMEDOUT), so the model gives up and falls back to plain `git
      // commit` → empty aiv context → no packet → the whole design-tests packet-flow breakage (observed F017).
      // Force a long ceiling for aiv commands, overriding any short `timeout` the model passes trying to cope.
      const isAivRun = /(^|[\s;&|])aiv\s+(commit|close|check)\b/.test(String(args.command || ""));
      // #132 (recovery): default non-aiv timeout 120s->60s. A hung command (stdin-block that #129 missed, or a
      // spawn starved by resource contention — observed: qwen3.5:0.8b bash ETIMEDOUT while the local model
      // saturated an 8GB machine) burns the full timeout PER call and the weak model re-issues it; 60s halves
      // the bleed and returns the model to a decision point sooner. aiv commands keep the 900s suite ceiling.
      const bashTimeout = isAivRun ? Math.max(Number(args.timeout) || 0, 900000) : (Number(args.timeout) || 60000);
      // #129: isolate stdin (input: "") so a command that READS stdin gets immediate EOF instead of blocking
      // the whole bashTimeout. OBSERVED (qwen3.5:0.8b drive): the weak model emitted malformed commands ending
      // in a bare `cat` / unclosed `|| cat`, which with an open empty stdin pipe hung 120s EACH — 12 turns
      // burned on ETIMEDOUT. A stdin-reading command is now a fast no-op, so the model gets its error and adapts.
      const r = spawnSync("bash", ["-lc", args.command], { cwd, timeout: bashTimeout, input: "", encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } });
      const out = (r.stdout || "") + (r.stderr || "");
      // #132 (recovery): an instructive timeout error — a weak model that gets a bare "ETIMEDOUT" just re-issues
      // the same command; tell it the command hung and what to do (simpler command, no stdin-reading, split it).
      if (r.error && /ETIMEDOUT/.test(String(r.error.message))) return `ERROR: command exceeded ${Math.round(bashTimeout / 1000)}s and was killed. Do NOT re-run it unchanged — it hung (a command that waits on stdin, or too heavy). Use a SIMPLER command (e.g. read one file, avoid interactive/streaming tools).\n${out}`;
      if (r.error) return `ERROR: ${r.error.message}\n${out}`;
      return out || `(exit ${r.status})`;
    }
    if (name === "Read") {
      const cp = confinePath(args.file_path);   // #133: repairs a stray-leading-slash worktree-relative path
      if (!cp.path) return OUTSIDE_MSG(args.file_path);
      const p = cp.path;
      if (!existsSync(p)) return `ERROR: file not found: ${p}`;
      const lines = readFileSync(p, "utf8").split("\n");
      const start = Math.max(0, (args.offset || 1) - 1);
      const end = args.limit ? start + args.limit : lines.length;
      return lines.slice(start, end).join("\n");
    }
    if (name === "Write") {
      const cp = confinePath(args.file_path);   // #133: repairs a stray-leading-slash worktree-relative path
      if (!cp.path) return OUTSIDE_MSG(args.file_path);
      const p = cp.path;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, args.content, "utf8");
      return `Written ${args.content.length} bytes to ${p}`;
    }
    if (name === "Edit") {
      // #120: exact-match single-site replace, same confinement as Write. Errors are INSTRUCTIVE (tell the
      // model exactly how to fix its call) because a weak model retries what it can parse.
      const cp = confinePath(args.file_path);   // #133: repairs a stray-leading-slash worktree-relative path
      if (!cp.path) return OUTSIDE_MSG(args.file_path);
      const p = cp.path;
      if (!existsSync(p)) return `ERROR: file not found: ${p}`;
      const txt = readFileSync(p, "utf8");
      const occ = txt.split(args.old_string).length - 1;
      if (occ === 0) return `ERROR: old_string not found in ${p} — it must match the file content EXACTLY (whitespace included). Read the file and copy the exact text.`;
      if (occ > 1 && !args.replace_all) return `ERROR: old_string matches ${occ} locations in ${p} — include more surrounding context to make it unique, or pass replace_all: true.`;
      // #120a: function replacer — String.replace(str, str) performs $-pattern substitution in the replacement
      // ($&, $', $1…), silently corrupting edits whose new_string contains '$' (shell/regex/Make content).
      writeFileSync(p, args.replace_all ? txt.split(args.old_string).join(args.new_string) : txt.replace(args.old_string, () => args.new_string), "utf8");
      return `Edited ${p}: replaced ${args.replace_all ? occ : 1} occurrence(s).`;
    }
    if (name === "Glob") {
      const gc = confinePath(args.path || ".");   // #133: stray-slash repair
      if (!gc.path) return OUTSIDE_MSG(args.path);
      const base = gc.path;
      const pat = String(args.pattern).replace(/[^\w*?\[\]{}\/.\-]/g, ""); // strip shell metachars; keep glob chars (#49 injection guard)
      const r = spawnSync("bash", ["-c", `cd '${base}' && shopt -s globstar nullglob dotglob 2>/dev/null; for f in ${pat}; do printf '%s\\n' "$f"; done | sort | head -200`], { encoding: "utf8", cwd });
      return r.stdout.trim() || "(no matches)";
    }
    if (name === "Grep") {
      const rc = confinePath(args.path || ".");   // #133: stray-slash repair
      if (!rc.path) return OUTSIDE_MSG(args.path);
      const gpath = rc.path;
      const cmd = `grep -rn ${args.recursive === false ? "" : "-r"} -- ${JSON.stringify(args.pattern)} ${JSON.stringify(gpath)} 2>/dev/null | head -100`;
      const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8", cwd, maxBuffer: 2 * 1024 * 1024 });
      return r.stdout.trim() || "(no matches)";
    }
    return `ERROR: unknown tool ${name}`;
  } catch (e) { return `ERROR: ${e.message}`; }
}

// #175 continue-on-length (pure predicate + message builder; selftested). A completion truncated at max_tokens
// (finish_reason "length") that is TEXT with no tool_calls lost whatever followed the cut. For a gate stage
// that tail is the required verdict block, so without recovery the stage can never finish. Stitch a
// continuation ONLY for a pure-text truncation (a truncated tool-call turn is left to the normal loop).
const needsContinuation = (ch, msg) =>
  !!(ch && ch.finish_reason === "length" && msg && msg.content && msg.content.trim() && !(msg.tool_calls && msg.tool_calls.length));
const buildContinuationMessages = (base, partial) => [
  ...base,
  { role: "assistant", content: partial },
  { role: "user", content: "Continue your previous message EXACTLY from where it was cut off — do NOT repeat any text already written and do NOT restart. Resume mid-sentence if needed and finish COMPLETELY, including any trailing machine-readable block the task requires." },
];
// Re-request the SAME model with the partial as an assistant prefix and concatenate until it stops naturally
// (finish != "length") or CONT_MAX rounds. Any transport failure just returns what we have — the pipeline's
// existing OUTAGE-retry still covers a total miss; this only recovers the common "ran out of room" case.
async function continueText(prov, mdl, baseMessages, firstContent) {
  let full = firstContent, fin = "length", rounds = 0;
  while (fin === "length" && rounds < CONT_MAX) {
    rounds++;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    let j;
    try {
      const resp = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.key()}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/Black-Box-Research-Labs/aiv-workflow", "X-Title": "fix-pipeline" },
        body: JSON.stringify({ model: mdl, messages: buildContinuationMessages(baseMessages, full), ...(TEXT_TOOLS ? {} : { tools: TOOLS, tool_choice: "auto" }), max_tokens: MAX_TOKENS }),
        signal: ctrl.signal,
      });
      if (!resp.ok) break;
      j = await resp.json();
    } catch { break; } finally { clearTimeout(to); }
    const ch = j.choices && j.choices[0], m = (ch && ch.message) || {};
    if (!m.content) break;
    full += m.content; fin = ch.finish_reason;
    if (m.tool_calls && m.tool_calls.length) break;   // a tool call appeared mid-continuation: stop, hand back
  }
  return { content: full, rounds, fin };
}

async function callModel(messages) {
  let lastErr;
  // walk the cascade: retry each model a few times on transient faults, then advance (sticky) to the
  // next entry. A dropped connection or 429 mid-stage is absorbed here so the pipeline doesn't re-spawn
  // the whole agent; a 402 credit-wall jumps straight to the next (cheaper/free) entry without retrying.
  while (activeIdx < cascade.length) {
    const entry = cascade[activeIdx];
    const { prov, model: mdl } = resolveEntry(entry);                     // #117: per-entry provider lane
    // #127: text-tool models reject the native `tools`/`tool_choice` params — omit them (the protocol lives in the prompt)
    const body = JSON.stringify({ model: mdl, messages, ...(TEXT_TOOLS ? {} : { tools: TOOLS, tool_choice: "auto" }), max_tokens: MAX_TOKENS });
    let advance = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      // #87: bound every request with an AbortController timeout. A free-model endpoint can ESTABLISH the
      // connection then hang with no response body (observed: 3 drives stalled 5.5min on an open :443 socket,
      // zero output, zero CPU). A hung fetch never throws, so without this the stage blocks until the drive's
      // 30-min timeoutMs nukes it. On timeout we abort -> AbortError -> caught below as transient -> retry,
      // then advance (sticky) to the next free model. Routes around a hung/overloaded model instead of waiting.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
      try {
        const resp = await fetch(prov.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${prov.key()}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/Black-Box-Research-Labs/aiv-workflow", "X-Title": "fix-pipeline" },
          body,
          signal: ctrl.signal,
        });
        if (resp.ok) {
          // #88: HTTP 200 is NOT proof of a usable answer. Reasoning-heavy free models (laguna/nemotron)
          // can spend MINUTES emitting reasoning tokens and then return finish_reason "error" with EMPTY
          // content and no tool_calls (measured: laguna 600s -> 200, finish=error, 0 content, 2973 reasoning
          // tokens). Returning that empty turn to the agent loop makes ZERO progress and the stage HALTs with
          // "no packet". Treat a 200-but-unusable response as a model fault: one quick retry (transient blip),
          // then advance the cascade (sticky) to the next free model — the same routing a 5xx gets.
          const j = await resp.json();
          const ch = j.choices && j.choices[0], msg = (ch && ch.message) || {};
          const usable = !!((msg.content && msg.content.trim()) || (msg.tool_calls && msg.tool_calls.length)) && ch?.finish_reason !== "error";
          if (usable) {
            // #175: if this usable turn is a pure-text answer that got cut at max_tokens, let the model finish
            // it (stitch continuations) so the trailing verdict block survives — mutate msg in place so the
            // returned envelope carries the complete text.
            if (needsContinuation(ch, msg)) {
              const st = await continueText(prov, mdl, messages, msg.content);
              if (st.rounds > 0) {
                console.error(`[shim] #175 continue-on-length: stitched ${st.rounds} continuation(s) on ${mdl} (final finish=${st.fin}, ${st.content.length}ch)`);
                msg.content = st.content;
                if (ch) ch.finish_reason = st.fin;
              }
            }
            return j;
          }
          lastErr = new Error(`OpenRouter 200 but UNUSABLE on ${mdl}: finish=${ch?.finish_reason} content=${(msg.content || "").length}ch reasoning=${(msg.reasoning || "").length}ch`);
          if (attempt < 2) { await new Promise((r) => setTimeout(r, 1000)); continue; }  // quick retry for a one-off blip
          advance = true; break;                                                          // persistent empty/error -> next model
        }
        const status = resp.status, errText = (await resp.text()).slice(0, 400);
        lastErr = new Error(`${prov.label} ${status} on ${mdl}: ${errText}`);
        if (status === 402) { advance = true; break; }                       // credit/spend wall -> next entry now
        // NB (#174): this daily-cap regex matches OPENROUTER's phrasing. NIM's rate-limit bodies differ, so a
        // NIM cap falls to the transient-429 arm below (4 bounded retries -> advance, no cooldown) — acceptable
        // because NIM's observed failure mode is hangs/latency (the abort branch), not day-caps; revisit if NIM
        // 429s appear in traces.
        if (status === 429 && /limit_rpd|per[-\s]?day|free-models-per-day|requests per day|daily/i.test(errText)) {
          // #117: the OR daily cap is ACCOUNT-level — a second account key is a fresh 1000/day pool for the
          // SAME model, so rotate keys (sticky) and retry THIS entry before conceding it to cooldown. Only
          // cooldown when every OR key is spent (cooldown is shared state; marking a model cooled while an
          // unspent key remains would wrongly hide it from every concurrent drive).
          if (prov.id === "or" && orKeyIdx < orKeys.length - 1) {
            orKeyIdx++;
            console.error(`[shim] OpenRouter account daily cap hit — rotating to account key #${orKeyIdx + 1} and retrying ${mdl}`);
            continue;
          }
          recordCooldown(entry, RL_COOLDOWN_MS);                              // #114: DAILY cap -> cooldown + advance NOW
          advance = true; break;                                             // do NOT burn 4 retries on a day-capped model
        }
        if (status === 429 || status === 408 || status >= 500) {              // transient (per-minute / 5xx) on this model
          if (attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
          // #180: an EXHAUSTED 5xx (server saturation — NIM "ResourceExhausted 101/32") or per-minute 429 is not
          // a one-off; the endpoint is overloaded. Cool it (like a hang, #179) so the NEXT agent spawn's cascade
          // SKIPS it and lands on a responsive lane, instead of re-probing the saturated one from the TOP every
          // spawn (activeIdx resets per `claude -p` process). OBSERVED (F004, sustained congestion): OR :free is
          // 429 upstream — SHARED across both OR accounts, so key rotation can't help — and NIM nemotron 503s,
          // so the drive stuck on the half-working NIM nemotron (it answers the SMALL turns, so the shim never
          // advanced) and never reached nim:openai/gpt-oss-120b, which handles even large 2000-tok requests in
          // ~14s. Cooling the saturated entries makes the cascade converge on the responsive lane automatically.
          recordCooldown(entry, HANG_COOLDOWN_MS, `saturated ${status}`);
          advance = true; break;                                             // exhausted -> next entry
        }
        throw lastErr;                                                        // other 4xx (e.g. 400) -> fatal
      } catch (e) {
        const em = String((e && e.message) || e) + " " + String((e && e.name) || "");
        const transient = /fetch failed|network|timeout|econnreset|socket|terminated|und_err|enotfound|eai_again|abort/i.test(em);
        const isHang = /abort/i.test(em);   // AbortController fired: endpoint accepted the connection then sent no response body
        lastErr = (isHang ? new Error(`request to ${mdl} aborted after ${REQ_TIMEOUT_MS}ms (no response — likely hung/overloaded free model)`) : e);
        if (isHang) {
          // #179: a HUNG endpoint does NOT self-heal on retry to the SAME socket. The old path retried it up to
          // 4x (~4×REQ_TIMEOUT ≈ 12min/model), so advancing through a congested nemotron prefix (ultra/super ×
          // OR+NIM) cost ~48min and SIGKILLed every heavy agent -> the drive HALTed on no-progress (F004 aiv-audit
          // r1-3, 2am free-tier congestion). Treat a hang like a credit-wall: COOL the model briefly so the NEXT
          // agent's cascade skips it and routes straight to a responsive entry (gpt-oss), and advance NOW with no
          // same-socket retries. Auto re-probes when the cooldown lapses (de-congestion self-heals).
          recordCooldown(entry, HANG_COOLDOWN_MS, "hung/overloaded");
          advance = true; break;
        }
        if (transient && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }   // genuine network blip -> retry same socket (can self-heal)
        if (transient) { advance = true; break; }                            // network/timeout exhausted -> next entry
        throw e;                                                             // non-transient -> fatal
      } finally {
        clearTimeout(to);
      }
    }
    if (advance) { activeIdx++; continue; }
  }
  throw lastErr || new Error("OpenRouter cascade exhausted");
}

async function run() {
  const systemMsg = [
    `You are ${activeModel()}, an AI model accessed via OpenRouter, executing a task in the fix-pipeline.`,
    `IDENTITY/PROVENANCE: In any AIV packet field (classified_by, classified_at author, evidence author), commit message, or self-reference, attribute this work to your ACTUAL model name — "${activeModel()}" — NEVER claim to be "Claude" or any model you are not. Honest provenance is mandatory.`,
    "You are an expert software engineer. Use the available tools (Bash, Read, Write, Glob, Grep) to complete the task.",
    "Execute tools to actually produce results — do not describe what you would do.",
    "All file paths are relative to the current working directory unless absolute.",
    sysPrompt,
    TEXT_TOOLS ? toolTextPreamble() : "",   // #127: inject the text tool-call protocol for non-function-calling models
  ].filter(Boolean).join("\n");
  const dirContext = addDirs.length ? `\nAccessible directories: ${addDirs.join(", ")}` : "";
  // #127: ONE-SHOT SEED for text-tool models — a described format is not enough for a 1B (observed: llama-3.2-1b
  // PARROTED the "TOOL RESULT" phrasing as plain text instead of emitting a call). Showing the exchange in
  // conversation form is what makes it comply (verified live). This teaches by example (prevention); the parser
  // + punt guard bound the outcome when it slips anyway (recovery).
  // #150a (seed rebalance — observed on qcoder design-tests): failing runs PARROTED the seed — emitting fake
  // "TOOL RESULT (Bash): head README.md" texts and even the literal final line "The README begins with the project
  // title." A 1-2B model imitates the most recent assistant exemplar, and the old seed's LAST assistant turn was
  // plain text — so its prior collapsed to narration. Rebalance: TWO call exemplars (different tools) so calls
  // dominate the assistant-exemplar distribution, and the closing text turn stays as the task-done exemplar.
  const seed = TEXT_TOOLS ? [
    { role: "user", content: "List the tests directory, then show the first lines of README.md, and report." },
    { role: "assistant", content: '<tool_call>{"name":"Bash","arguments":{"command":"ls tests/"}}</tool_call>' },
    { role: "user", content: "TOOL RESULT (Bash):\ntest_a.py\ntest_b.py" },
    { role: "assistant", content: '<tool_call>{"name":"Read","arguments":{"file_path":"README.md","limit":5}}</tool_call>' },
    { role: "user", content: "TOOL RESULT (Read):\n# Project\n..." },
    { role: "assistant", content: "tests/ holds test_a.py and test_b.py; the README begins with the project title." },
  ] : [];
  const messages = [{ role: "system", content: systemMsg + dirContext }, ...seed, { role: "user", content: prompt }];
  let turns = 0, finalText = "", totalToolCalls = 0, traceMark = 0;
  let _fmtRepairs = 0;    // #148: bounded format-repair reprompts (unparsed tool attempts must not end the run)
  const _callSigs = [];   // #127b: circuit breaker — detect a model stuck repeating the SAME failing tool call
  trace({ kind: "run_start", model_cascade: cascade, add_dirs: addDirs, max_turns: maxTurns, system_len: (systemMsg + dirContext).length, prompt_len: prompt.length });
  while (turns < maxTurns) {
    turns++;
    const _t0 = Date.now(), _sent = messages.slice(traceMark);   // trace: the NEW context this turn sees (turn 1 = system+user)
    let data;
    try { data = await callModel(messages); }
    catch (e) {
      // classify so the pipeline's transient-retry regex fires ONLY on retryable errors (429/408/5xx/network/
      // timeout) and FAILS FAST on fatal ones (e.g. 400 bad-model) instead of burning 5 retries. (#429 note)
      const m = String(e.message || e);
      const retryable = /\b(429|408|5\d\d)\b/.test(m) || /fetch failed|network|timeout|temporar|overload|connection|rate.?limit|econnreset|socket/i.test(m);
      const result = retryable ? `temporary API error (retryable): ${m}` : `fatal API failure (do not retry): ${m.replace(/error/gi, "fault")}`;
      trace({ kind: "run_error", turn: turns, model: activeModel(), cascade_idx: activeIdx, latency_ms: Date.now() - _t0, retryable, error: m });
      process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, result, model: activeModel() }));
      process.exit(1);
    }
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) { trace({ kind: "turn", turn: turns, model: data.model || activeModel(), cascade_idx: activeIdx, latency_ms: Date.now() - _t0, usage: data.usage || null, note: "no message in response" }); break; }
    messages.push(message);
    traceMark = messages.length;   // trace boundary AFTER the assistant: next turn's _sent = the tool results we push below
    const _rec = { kind: "turn", turn: turns, model: data.model || activeModel(), cascade_idx: activeIdx,
      latency_ms: Date.now() - _t0, usage: data.usage || null, finish_reason: choice?.finish_reason ?? null,
      sent_messages: _sent,
      // #117b: NIM's OpenAI-compat returns reasoning under `reasoning_content` (OR uses `reasoning`) — capture
      // either, or NIM-lane turns trace with empty reasoning and the observability loop loses its highest-signal line.
      assistant: { content: message.content ?? null, reasoning: message.reasoning ?? message.reasoning_content ?? null,
        tool_calls: (message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments })) },
      tool_execs: [] };
    // #127: text-tool models emit calls in the content (no native tool_calls array) — synthesize them
    const toolCalls = (message.tool_calls && message.tool_calls.length) ? message.tool_calls
      : (TEXT_TOOLS ? parseTextToolCalls(message.content || "") : []);
    if (TEXT_TOOLS && toolCalls.length) {
      _rec.assistant.tool_calls = toolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments, textparsed: true }));
      // #127a: a small model often HALLUCINATES its own "TOOL RESULT" after the call (learned from the seed) —
      // strip everything after the last </tool_call> in the pushed assistant message so the fake result never
      // pollutes context (it would otherwise teach the model its hallucination was accepted).
      const cut = (message.content || "").lastIndexOf("</tool_call>");
      if (cut >= 0) message.content = message.content.slice(0, cut + "</tool_call>".length);
    }
    if (toolCalls.length === 0) {
      const txt = (message.content || "").trim();
      // #148 (recovery half): a completion with ZERO parsed calls that still LOOKS like a tool attempt (a fake
      // "TOOL RESULT (X):" hallucination, an unparseable call fragment, or a narrated Write) must NOT end the run
      // as the final answer — that is how every 1B design-tests run died at turn 1 "ok=true" while its work was
      // pure narration. Reprompt ONCE per incident (bounded _fmtRepairs) with the exact required format; the
      // deterministic harness bounds the outcome instead of accepting a non-answer.
      if (TEXT_TOOLS && _fmtRepairs < 3 && turns < maxTurns - 1
          && /TOOL RESULT|<tool_call|"(?:name|tool)"\s*:\s*"(?:Bash|Read|Write|Edit|Grep|Glob)"/i.test(txt)) {
        _fmtRepairs++;
        _rec.note = `format-repair reprompt ${_fmtRepairs}/3 (tool attempt did not parse)`; trace(_rec);
        messages.push({ role: "user", content: `FORMAT ERROR — NO tool was executed. Anything that looks like a TOOL RESULT in your last message was YOUR OWN INVENTION; only I (the harness) run tools and return results. To actually run a tool, reply with EXACTLY one line per call and NOTHING else:\n<tool_call>{"name":"<Bash|Read|Write|Edit|Grep|Glob>","arguments":{...}}</tool_call>\nRe-issue the call(s) you intended NOW in that exact format. Do not write results, do not use \`\`\`json fences, do not describe the call in prose.` });
        process.stderr.write(`[shim] #148 format-repair reprompt ${_fmtRepairs}/3 (unparsed tool attempt)\n`);
        continue;
      }
      // An empty completion (no text, no tool calls, nothing done all run) is a NON-answer — a weak driver
      // punting on a heavy stage. Do NOT pass it through as success (the gate would then HALT on the missing
      // machine block). Advance to the next FREE model and retry the stage; only give up when the cascade is
      // exhausted. (Generalizable #41 hardening — surfaced on or-review with gpt-oss-120b:free returning "".)
      if (!txt && totalToolCalls === 0 && activeIdx < cascade.length - 1) {
        _rec.note = "empty-completion punt -> cascade hop"; trace(_rec);
        messages.pop();                    // drop the empty assistant turn
        traceMark = messages.length;        // keep the trace boundary consistent after the pop
        activeIdx++;                        // next free model in the cascade
        turns--;                            // don't burn the turn budget on the punt
        process.stderr.write(`[shim] empty completion from previous model; retrying stage with ${activeModel()}\n`);
        continue;
      }
      finalText = txt;
      trace(_rec);
      break;
    }
    totalToolCalls += toolCalls.length;
    const toolResults = [];
    for (const tc of toolCalls) {
      let args; try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
      const rep = repairToolArgs(tc.function.name, args); args = rep.args;   // #101: validate-then-repair (schema-aware)
      const missing = requiredMissing(tc.function.name, args);
      let result;
      if (missing.length) {                                                 // surface a MODEL-READABLE retry msg, not a silent no-op
        result = `ERROR: your ${tc.function.name} call is missing required argument(s): ${missing.join(", ")}. Retry the SAME call WITH those field(s) populated (do not omit them).`;
        process.stderr.write(`[tool-invalid] ${tc.function.name}: missing ${missing.join(",")}\n`);
      } else {
        if (rep.repairs.length) process.stderr.write(`[tool-repaired] ${tc.function.name}: ${rep.repairs.join(", ")}\n`);   // per-tool repair telemetry
        result = execTool(tc.function.name, args);
      }
      process.stderr.write(`[tool] ${tc.function.name}(${JSON.stringify(args).slice(0, 120)}) → ${String(result).slice(0, 200)}\n`);
      _rec.tool_execs.push({ name: tc.function.name, args, repairs: rep.repairs, missing, result: String(result) });   // UNTRUNCATED for the trace
      toolResults.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
    }
    // #127: text-tool models don't understand role:"tool" (no native tool_call_id to reference) — feed the
    // results back as ONE user message in the protocol's "TOOL RESULT" form; the native path keeps role:"tool".
    if (TEXT_TOOLS) messages.push({ role: "user", content: toolResults.map((r, i) => `TOOL RESULT (${toolCalls[i].function.name}):\n${r.content}`).join("\n\n") });
    else messages.push(...toolResults);
    trace(_rec);
    // #127b: circuit breaker for a model stuck repeating an identical FAILING call (weak models loop on an
    // error instead of adapting — observed: llama-3.2-1b re-issued the same errored Read 60× to the turn cap).
    // Signature = the exec (name+args) + whether it errored; 4 identical erroring reps → inject a hard nudge
    // once, and if it STILL repeats, stop (fail-closed) rather than burn the whole budget.
    const lastErr = _rec.tool_execs.length && _rec.tool_execs.every((e) => /^ERROR/.test(String(e.result)));
    const sig = _rec.tool_execs.map((e) => `${e.name}:${JSON.stringify(e.args)}:${lastErr}`).join("|");
    _callSigs.push(sig);
    const reps = _callSigs.filter((s) => s === sig).length;
    if (lastErr && reps === 4) messages.push({ role: "user", content: "STOP repeating the same failing call — it returned the SAME error every time. Read the error, CHANGE your approach (different path/args/tool) or, if the task cannot proceed, reply with plain text explaining why. Do NOT repeat the identical call." });
    if (lastErr && reps >= 6) { process.stderr.write(`[shim] #127b circuit breaker: identical failing call repeated ${reps}× — stopping\n`); finalText = `HALTED: model looped on an identical failing call (${_rec.tool_execs.map((e) => e.name).join(",")}); last error: ${String(_rec.tool_execs[0]?.result).slice(0, 200)}`; break; }
    // native tool-calling returns finish_reason "tool_calls"; text-tool models return "stop" even mid-task, so
    // never treat stop as done when we just executed text-parsed calls — keep looping until a no-tool reply.
    if (choice.finish_reason === "stop" && !TEXT_TOOLS) { finalText = message.content || ""; break; }
  }
  // A run that produced ZERO tool calls AND no final text did nothing usable (the whole cascade punted on
  // a heavy stage). Emit an ERROR envelope so the pipeline sees an OUTAGE (fail-closed HALT / its own
  // retry) — never a false "success" with an empty result. (A run that wrote files via tool calls is fine
  // even with empty finalText: the gate reads the machine block from the file, so totalToolCalls>0 passes.)
  if (totalToolCalls === 0 && !finalText.trim()) {
    trace({ kind: "run_end", ok: false, turns, total_tool_calls: totalToolCalls, final_text_len: finalText.length, model: activeModel(), note: "empty completion across cascade" });
    process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "empty completion: model produced no tool calls and no content across the free cascade (heavy-stage punt)", model: activeModel() }));
    process.exit(1);
  }
  trace({ kind: "run_end", ok: true, turns, total_tool_calls: totalToolCalls, final_text_len: finalText.length, model: activeModel() });
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: finalText, num_turns: turns, total_cost_usd: null, model: activeModel() }));
  process.exit(0);
}
// #101: tool-input-repair selftest (zero-API). Run: node claude-or-shim.mjs --selftest-tools
if (argsIn.includes("--selftest-tools")) {
  let pass = 0, fail = 0; const t = (n, c) => { if (c) { pass++; } else { fail++; console.error("FAIL: " + n); } };
  // the LIVE-observed failures:
  t("Write({path}) -> file_path (gpt-oss live)", repairToolArgs("Write", { path: "a.md", content: "x" }).args.file_path === "a.md");
  t("Bash({}) -> missing 'command' surfaced (was silent no-op)", requiredMissing("Bash", repairToolArgs("Bash", {}).args).includes("command"));
  // schema-aware: Grep's legitimate `path` is NOT rewritten
  t("Grep({path}) keeps path (legit search dir, not file_path)", repairToolArgs("Grep", { pattern: "x", path: "src" }).args.path === "src" && repairToolArgs("Grep", { pattern: "x", path: "src" }).args.file_path === undefined);
  // the four shape repairs + path-unwrap
  t("['x'] single-elem array -> 'x'", repairToolArgs("Write", { file_path: ["a.md"], content: "x" }).args.file_path === "a.md");
  t("markdown auto-link path unwrapped", repairToolArgs("Write", { file_path: "[notes.md](http://notes.md)", content: "x" }).args.file_path === "notes.md");
  t("real markdown link (text!=url) passes through untouched", repairToolArgs("Write", { file_path: "[click](https://x.com)", content: "x" }).args.file_path === "[click](https://x.com)");
  t("null on OPTIONAL field dropped (timeout)", repairToolArgs("Bash", { command: "ls", timeout: null }).args.timeout === undefined);
  t("valid input untouched (no repairs)", repairToolArgs("Read", { file_path: "a.py", limit: 30 }).repairs.length === 0);
  t("missing required reported for Write w/o content", requiredMissing("Write", { file_path: "a.md" }).includes("content"));
  t("trace() no-ops without FIX_SHIM_TRACE (observability never breaks a drive)", (() => { const o = process.env.FIX_SHIM_TRACE; delete process.env.FIX_SHIM_TRACE; let ok = true; try { trace({ x: 1 }); } catch { ok = false; } if (o !== undefined) process.env.FIX_SHIM_TRACE = o; return ok; })());
  t("confine: cwd-relative path is allowed", withinAllowed("subdir/file.txt") === true && withinAllowed(cwd) === true);
  t("confine: absolute escape is blocked", withinAllowed("/etc/passwd") === false);
  t("confine: sibling-session scratch is blocked (the F017 leak vector)", withinAllowed("/private/tmp/claude-501/2d4c749e-other-session/scratchpad/x.md") === false);
  t("aiv commands get the long bash timeout (aiv commit/close run the suite; 120s default SIGKILLs them)", (() => { const c = (cmd) => /(^|[\s;&|])aiv\s+(commit|close|check)\b/.test(cmd); return c("aiv commit foo.py -m x -i url") && c("cd wt && aiv close") && c("timeout 60 aiv commit f") && !c("git commit -m x") && !c("aivx commit") && !c("echo aiv is a tool"); })());
  // #117: provider-lane resolution — 'nim:' prefix routes to NVIDIA NIM; ':free' stays a MODEL suffix on OR entries
  t("#117 resolveEntry: bare OR entry keeps full model id incl. :free suffix", (() => { const r = resolveEntry("nvidia/nemotron-3-ultra-550b-a55b:free"); return r.prov.id === "or" && r.model === "nvidia/nemotron-3-ultra-550b-a55b:free"; })());
  t("#117 resolveEntry: nim: prefix routes to NVIDIA NIM with the bare model id", (() => { const r = resolveEntry("nim:nvidia/nemotron-3-ultra-550b-a55b"); return r.prov.id === "nim" && r.model === "nvidia/nemotron-3-ultra-550b-a55b" && /integrate\.api\.nvidia\.com/.test(r.prov.url); })());
  // #174 (hermetic): the old form required an OR key IN THE TEST ENVIRONMENT (orKeys is captured at module load;
  // harnesses that `unset OPENROUTER_API_KEY` made this fail spuriously). Inject a sentinel key for the OR-side
  // assertion instead of depending on the caller's env.
  t("#117 keyless-provider entries are filterable (nim mirror inert without NVIDIA_API_KEY)", (() => {
    const o = process.env.NVIDIA_API_KEY; delete process.env.NVIDIA_API_KEY;
    const inert = !resolveEntry("nim:openai/gpt-oss-120b").prov.key();
    if (o !== undefined) process.env.NVIDIA_API_KEY = o;
    orKeys.push("sk-selftest-sentinel");
    const orKeyed = !!resolveEntry("openai/gpt-oss-120b:free").prov.key();
    orKeys.pop();
    return inert && orKeyed; })());
  t("#117 every cascade tier interleaves a nim mirror directly after its OR twin (quality order preserved)", (() => { for (const tierList of Object.values(CASCADE)) for (let i = 0; i < tierList.length; i++) { if (tierList[i].startsWith("nim:")) { const bare = tierList[i].slice(4); if (!(tierList[i - 1] || "").startsWith(bare)) return false; } } return true; })());
  // #120: the Edit tool — surgical replace with instructive errors + the same confinement as Write
  { const tf = `${cwd}/.selftest_edit_${process.pid}.txt`; writeFileSync(tf, "alpha\nbeta\nalpha\n", "utf8");
    t("#120 Edit: unique match replaces exactly one site", execTool("Edit", { file_path: tf, old_string: "beta", new_string: "BETA" }).startsWith("Edited") && readFileSync(tf, "utf8") === "alpha\nBETA\nalpha\n");
    t("#120 Edit: ambiguous match errors with count (no blind replace)", /matches 2 locations/.test(execTool("Edit", { file_path: tf, old_string: "alpha", new_string: "A" })));
    t("#120 Edit: replace_all replaces every occurrence", /replaced 2/.test(execTool("Edit", { file_path: tf, old_string: "alpha", new_string: "A", replace_all: true })) && readFileSync(tf, "utf8") === "A\nBETA\nA\n");
    t("#120 Edit: not-found errors instructively", /not found/.test(execTool("Edit", { file_path: tf, old_string: "nope", new_string: "x" })));
    t("#120 Edit: confinement blocks outside-workspace paths", /OUTSIDE the allowed workspace/.test(execTool("Edit", { file_path: "/etc/hosts", old_string: "a", new_string: "b" })));
    // #133: stray-leading-slash repair — '/<rel>' that exists in the worktree is remapped, a true escape is not
    { const rf = `${cwd}/.selftest_slash_${process.pid}.txt`; writeFileSync(rf, "hello", "utf8");
      t("#133 confinePath: '/<rel>' whose stripped form exists in cwd is repaired", confinePath("/" + `.selftest_slash_${process.pid}.txt`).repaired === true);
      t("#133 confinePath: a genuine escape ('/etc/hosts') is NOT repaired", confinePath("/etc/hosts").path === null);
      t("#133 confinePath: a normal relative path resolves un-repaired", confinePath(`.selftest_slash_${process.pid}.txt`).repaired === false);
      t("#133 Read via stray-slash path succeeds (the qwen 0.8b failure mode)", execTool("Read", { file_path: "/" + `.selftest_slash_${process.pid}.txt` }) === "hello");
      try { rmSync(rf, { force: true }); } catch {} }
    // #120a: $-sequences in new_string must land LITERALLY (String.replace(str,str) would expand $& to the match)
    writeFileSync(tf, "price=X\n", "utf8");
    execTool("Edit", { file_path: tf, old_string: "X", new_string: "$& + $'fee$1" });
    t("#120a Edit: replacement containing $&/$'/$1 is written literally, never pattern-expanded", readFileSync(tf, "utf8") === "price=$& + $'fee$1\n");
    try { rmSync(tf, { force: true }); } catch {} }
  // #127: text-tool parsing — the sub-3B path (no native function-calling)
  t("#127 parseTextToolCalls: extracts a <tool_call> block into the native shape", (() => { const r = parseTextToolCalls('<tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>'); return r.length === 1 && r[0].function.name === "Bash" && JSON.parse(r[0].function.arguments).command === "ls"; })());
  t("#127 parseTextToolCalls: multiple calls + surrounding prose", (() => { const r = parseTextToolCalls('sure:\n<tool_call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call>\n<tool_call>{"name":"Read","arguments":{"file_path":"b"}}</tool_call>'); return r.length === 2 && r[1].function.name === "Read"; })());
  t("#127 parseTextToolCalls: bare name/arguments object fallback (no wrapper)", (() => { const r = parseTextToolCalls('{"name":"Glob","arguments":{"pattern":"*.py"}}'); return r.length === 1 && r[0].function.name === "Glob"; })());
  t("#127 parseTextToolCalls: plain prose (a final answer) yields no calls", parseTextToolCalls("The file looks correct; no changes needed.").length === 0);
  t("#127 parseTextToolCalls: 'args' synonym accepted, malformed json dropped", (() => { const r = parseTextToolCalls('<tool_call>{"name":"Bash","args":{"command":"pwd"}}</tool_call><tool_call>{oops}</tool_call>'); return r.length === 1 && JSON.parse(r[0].function.arguments).command === "pwd"; })());
  t("#127 toolTextPreamble: lists every tool with required/optional-arg markers + the format", (() => { const p = toolTextPreamble(); return /<tool_call>/.test(p) && /Bash\(command, timeout\?\)/.test(p) && /Read\(file_path, offset\?, limit\?\)/.test(p) && /Edit\(file_path, old_string, new_string, replace_all\?\)/.test(p); })());
  // #175 continue-on-length: pure predicate + message builder (the fetch loop is I/O, exercised live)
  t("#175 needsContinuation: length + text + no tool_calls -> true", needsContinuation({ finish_reason: "length" }, { content: "partial audit..." }) === true);
  t("#175 needsContinuation: length but tool_calls present -> false (don't stitch a tool turn)", needsContinuation({ finish_reason: "length" }, { content: "x", tool_calls: [{ id: "1" }] }) === false);
  t("#175 needsContinuation: finish_reason stop -> false", needsContinuation({ finish_reason: "stop" }, { content: "done" }) === false);
  t("#175 needsContinuation: empty/whitespace content -> false", needsContinuation({ finish_reason: "length" }, { content: "  " }) === false);
  t("#175 buildContinuationMessages: appends assistant-partial then a no-repeat user nudge", (() => { const m = buildContinuationMessages([{ role: "user", content: "audit" }], "PHASE 0..."); return m.length === 3 && m[1].role === "assistant" && m[1].content === "PHASE 0..." && m[2].role === "user" && /machine-readable block/.test(m[2].content) && /do NOT repeat/i.test(m[2].content); })());
  t("#175 MAX_TOKENS raised above the old 8192 probe default", MAX_TOKENS >= 16384);
  console.error(`tool-repair selftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: String(e) })); process.exit(1); });
