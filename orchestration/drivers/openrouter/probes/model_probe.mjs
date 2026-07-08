#!/usr/bin/env node
// Decisive agentic-loop probe for an OpenRouter model. Tests the EXACT capability chain the
// fix-pipeline needs: (1) emit a tool call, (2) PARSE the tool return, (3) make a 2nd dependent
// tool call, (4) hand off via a written file holding a fenced machine block. Answer = server-side
// secret*3, unguessable from the prompt -> only a model that parses tool returns can pass.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const model = process.argv[2];
const secretFile = process.argv[3];
const outFile = process.argv[4];
const K = parseInt(readFileSync(secretFile, "utf8").trim(), 10);
const expected = K * 3;
const API_KEY = process.env.OPENROUTER_API_KEY;

const TOOLS = [
  { type: "function", function: { name: "Bash", description: "Run a bash command, returns stdout.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "Write", description: "Write content to a file.", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
];

function execTool(name, args) {
  try {
    if (name === "Bash") { const r = spawnSync("bash", ["-lc", args.command], { encoding: "utf8", timeout: 30000 }); return (r.stdout || "") + (r.stderr || ""); }
    if (name === "Write") { const p = resolve(args.file_path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, args.content, "utf8"); return `wrote ${args.content.length} bytes to ${p}`; }
    return `unknown tool ${name}`;
  } catch (e) { return `ERROR ${e.message}`; }
}

async function callModel(messages) {
  const body = JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 4096 });
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "X-Title": "probe" }, body });
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 300);
      if ((r.status === 429 || r.status >= 500) && a < 3) { await new Promise((x) => setTimeout(x, 2000 * a)); continue; }
      return { __httperr: `${r.status}: ${t}` };
    } catch (e) { if (a < 3) { await new Promise((x) => setTimeout(x, 2000 * a)); continue; } return { __neterr: String(e.message || e) }; }
  }
}

const t0 = Date.now();
const sys = "You are an autonomous agent with Bash and Write tools. Use the tools to complete the task. Do NOT guess values — read them from tool outputs. Substitute real values, never placeholders.";
const user = `Do exactly this, using tools:\n1. Call Bash with command: cat ${secretFile}  -> it returns an integer K.\n2. Compute K*3.\n3. Call Write with file_path "${outFile}" and content being EXACTLY a fenced json block:\n\`\`\`json\n{"answer": <the value of K*3>, "model_self_id": "<the name of the model you are>"}\n\`\`\`\nThen stop. Do not output anything after the Write.`;
let messages = [{ role: "system", content: sys }, { role: "user", content: user }];
let turns = 0, toolCalls = 0, bashSawReturn = false, wroteFile = false, transcript = [];

const MAX = 8;
let httperr = null;
while (turns < MAX) {
  turns++;
  const data = await callModel(messages);
  if (data.__httperr) { httperr = "HTTP " + data.__httperr; break; }
  if (data.__neterr) { httperr = "NET " + data.__neterr; break; }
  const msg = data.choices?.[0]?.message;
  if (!msg) { httperr = "no message: " + JSON.stringify(data).slice(0, 200); break; }
  messages.push(msg);
  const tcs = msg.tool_calls || [];
  if (tcs.length === 0) { transcript.push(`turn${turns}: text="${(msg.content || "").slice(0, 80)}"`); break; }
  for (const tc of tcs) {
    toolCalls++;
    let args; try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
    const result = execTool(tc.function.name, args);
    if (tc.function.name === "Bash" && String(result).includes(String(K))) bashSawReturn = true;
    if (tc.function.name === "Write" && args.file_path) wroteFile = true;
    transcript.push(`turn${turns}: ${tc.function.name}(${JSON.stringify(args).slice(0, 60)}) -> ${String(result).slice(0, 50)}`);
    messages.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
  }
}
const ms = Date.now() - t0;

// grade
let answerOk = false, parsedAnswer = null, fileContent = null;
if (existsSync(outFile)) {
  fileContent = readFileSync(outFile, "utf8");
  const m = fileContent.match(/"answer"\s*:\s*(\d+)/);
  if (m) { parsedAnswer = parseInt(m[1], 10); answerOk = parsedAnswer === expected; }
}
let verdict;
if (httperr) verdict = "ERROR";
else if (toolCalls === 0) verdict = "NO_TOOL_CALL";          // can't drive at all
else if (!bashSawReturn && !wroteFile) verdict = "LOOP_BROKEN"; // called tool but never used return (Owl mode)
else if (answerOk) verdict = "PASS";
else if (wroteFile && !answerOk) verdict = "WRONG_ANSWER";    // did the loop but math/parse wrong
else verdict = "INCOMPLETE";

console.log(JSON.stringify({
  model, verdict, ms, turns, toolCalls, bashSawReturn, wroteFile, expected, parsedAnswer, httperr,
  transcript: transcript.slice(0, 12),
}));
