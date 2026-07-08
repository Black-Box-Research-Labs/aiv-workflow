#!/usr/bin/env node
// "Mini-drive": the fix-pipeline's goal-loop in miniature. A real bug + a failing pytest. The model
// must read, edit, run pytest, parse the result, iterate, converge. Graded by INDEPENDENTLY running
// pytest at the end (the model's self-claim is never trusted). This separates "can run a loop" (toy
// probe) from "can actually fix code in a loop" (what HALTs weak drivers).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const model = process.argv[2];
const workdir = process.argv[3];
const API_KEY = process.env.OPENROUTER_API_KEY;

// fresh fixture every run
rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
writeFileSync(join(workdir, "stats.py"), `def median(nums):
    s = sorted(nums)
    n = len(s)
    return s[n // 2]
`);
writeFileSync(join(workdir, "test_stats.py"), `from stats import median
def test_odd():
    assert median([3, 1, 2]) == 2
def test_even():
    assert median([1, 2, 3, 4]) == 2.5
`);

const TOOLS = [
  { type: "function", function: { name: "Bash", description: "Run a bash command in the project dir. Returns stdout+stderr.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "Read", description: "Read a file.", parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } } },
  { type: "function", function: { name: "Write", description: "Overwrite a file with full new content.", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
];
function execTool(name, args) {
  try {
    if (name === "Bash") { const r = spawnSync("bash", ["-lc", args.command], { cwd: workdir, encoding: "utf8", timeout: 30000 }); return ((r.stdout || "") + (r.stderr || "")).slice(0, 2000) || `(exit ${r.status})`; }
    if (name === "Read") { const p = resolve(workdir, args.file_path); return existsSync(p) ? readFileSync(p, "utf8") : `not found: ${p}`; }
    if (name === "Write") { writeFileSync(resolve(workdir, args.file_path), args.content, "utf8"); return `wrote ${args.content.length} bytes`; }
    return `unknown tool ${name}`;
  } catch (e) { return `ERROR ${e.message}`; }
}
async function callModel(messages) {
  const body = JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 4096 });
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "X-Title": "probe-fix" }, body });
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 200);
      if ((r.status === 429 || r.status >= 500) && a < 3) { await new Promise((x) => setTimeout(x, 3000 * a)); continue; }
      return { __err: `HTTP ${r.status}: ${t}`, __rl: r.status === 429 };
    } catch (e) { if (a < 3) { await new Promise((x) => setTimeout(x, 3000 * a)); continue; } return { __err: "NET " + String(e.message || e) }; }
  }
}

const t0 = Date.now();
const sys = "You are an autonomous coding agent with Bash, Read, and Write tools, working in the current project directory. Fix bugs by reading code, editing files (Write overwrites the whole file), and running tests. Verify with the tools — do not claim success without running the test.";
const user = "The test suite fails. Run `python3 -m pytest -q` to see the failures, read stats.py, fix the bug in median() so BOTH tests pass (the even-length case is broken), and re-run pytest to confirm all tests pass. When pytest is green, reply 'DONE'.";
let messages = [{ role: "system", content: sys }, { role: "user", content: user }];
let turns = 0, toolCalls = 0, ranPytest = false, rateLimited = false, err = null;
const MAX = 12;
while (turns < MAX) {
  turns++;
  const data = await callModel(messages);
  if (data.__err) { err = data.__err; if (data.__rl) rateLimited = true; break; }
  const msg = data.choices?.[0]?.message; if (!msg) { err = "no-msg"; break; }
  messages.push(msg);
  const tcs = msg.tool_calls || [];
  if (tcs.length === 0) break;
  for (const tc of tcs) {
    toolCalls++;
    let args; try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
    if (tc.function.name === "Bash" && /pytest|unittest/.test(args.command || "")) ranPytest = true;
    const result = execTool(tc.function.name, args);
    messages.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
  }
}
// INDEPENDENT grade: run pytest ourselves, never trust the model
const g = spawnSync("bash", ["-lc", "python3 -m pytest -q 2>&1 | tail -3"], { cwd: workdir, encoding: "utf8", timeout: 30000 });
const passed = g.status === 0;
console.log(JSON.stringify({ model, verdict: err ? (rateLimited ? "RATE_LIMITED" : "ERROR") : (passed ? "FIXED" : "NOT_FIXED"), ms: Date.now() - t0, turns, toolCalls, ranPytest, err }));
