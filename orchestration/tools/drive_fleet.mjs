#!/usr/bin/env node
// drive_fleet.mjs — launch MANY fix-pipeline drives concurrently (max-throughput mode).
//
// drive_next.mjs serializes (one drive at a time). This launches a FLEET: each pending finding gets its own
// worktree + branch + spec + detached supervisor, all pushing trajectory to the SHARED training repo
// (traindataPush is rebase-on-reject precisely so N agents can share one corpus origin). Fleet state lives in a
// gitignored sidecar (src/fix/.work/fleet.json) so the tracked queue.jsonl never churns during the burn.
//
//   node drive_fleet.mjs --launch N     # intake + launch up to N NEW pending drives (skips fixed/inflight/fleet)
//   node drive_fleet.mjs --status       # per-drive stage/terminal + rollup + uploaded-stage counts
//   node drive_fleet.mjs --refill N     # launch enough NEW drives to bring the ACTIVE (non-terminal) count up to N
//   node drive_fleet.mjs --reap         # drop terminal drives from the fleet (frees the slot for --refill)
//
// Ignores depends_on by design (drives are independent from origin/main) — max parallelism for training-data burn.
// Prereqs (same as drive_next --go): FIX_TRAINDATA_DIR (writable clone), GIT_TOKEN, claude + aiv on PATH.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const PIPE = join(SRC, "fix_pipeline.mjs");
const SUP = join(SRC, "drive_supervisor.sh");
const QUEUE = join(SRC, "queue.jsonl");
const FLEET = join(SRC, "fix", ".work", "fleet.json");
const LOG_DIR = join(SRC, "fix", ".work", "logs");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const REPO_FULL = arg("--repo", "Black-Box-Research-Labs/aiv-protocol");
const REPO_PATH = arg("--repo-path", "/home/user/aiv-protocol");
const AUDIT_FILE = arg("--audit-file", "docs/audits/2026-06-18-forensic/02-static-audit.md");
const BASE = arg("--base", "origin/main");

const loadQueue = () => readFileSync(QUEUE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const loadFleet = () => (existsSync(FLEET) ? JSON.parse(readFileSync(FLEET, "utf8")) : { drives: {} });
const saveFleet = (f) => writeFileSync(FLEET, JSON.stringify(f, null, 2));

const TERMINAL_RE = /SPINE COMPLETE|DONE — H2 resolved|finding REFUTED \(exit 5\)|fail-closed HALT \(exit 3\)|STOP — FATAL|STOP — deterministic gate|exhausted \d+ attempts/;
function driveState(d) {                                  // read a drive's log → {stage, terminal}
  if (!d.log || !existsSync(d.log)) return { stage: "(starting)", terminal: null };
  const t = readFileSync(d.log, "utf8");
  const scoped = t.slice(t.lastIndexOf("START detached pid="));
  let terminal = null;
  if (/finding REFUTED \(exit 5\)/.test(scoped)) terminal = "refuted";
  else if (/SPINE COMPLETE|DONE — H2 resolved/.test(scoped)) terminal = "done";
  else if (/fail-closed HALT \(exit 3\)|STOP — FATAL|STOP — deterministic gate|exhausted \d+ attempts/.test(scoped)) terminal = "halted";
  const stages = [...scoped.matchAll(/stage '([a-z-]+)'/g)];
  const stage = stages.length ? stages[stages.length - 1][1] : "(starting)";
  return { stage, terminal };
}

function launch(row, fleet) {
  const fid = row.finding_id;
  const prefix = row.change_prefix || `aiv-${String(fid).toLowerCase()}`;
  const intake = ["--intake", "--finding-id", fid, "--repo", row.repo_full || REPO_FULL,
    "--repo-path", REPO_PATH, "--audit-file", AUDIT_FILE, "--change-prefix", prefix, "--base", BASE];
  if (row.goal_condition) intake.push("--goal", row.goal_condition);
  let out = "";
  try {
    out = execFileSync("node", [PIPE, ...intake], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = String(e.stderr || e.stdout || e.message || "");
    if (/REFUSING .*MERGED PR/.test(err)) { console.error(`  ${fid}: SKIP — merged PR (already fixed)`); return "merged"; }
    console.error(`  ${fid}: intake FAILED — ${err.trim().split("\n").pop()}`); return "error";
  }
  if (/has an OPEN PR on another branch/.test(out)) { console.error(`  ${fid}: SKIP — open PR (inflight)`); return "inflight"; }
  const m = (out + "\n").match(/--drive --spec (\S+)/);
  const spec = m ? m[1] : join(SRC, "fix", ".work", `spec_${fid}.json`);
  if (!existsSync(spec)) { console.error(`  ${fid}: spec missing after intake`); return "error"; }
  const log = join(LOG_DIR, `${prefix}.log`);
  execFileSync("bash", ["-lc", `mkdir -p ${JSON.stringify(LOG_DIR)}`]);
  const p = spawn("bash", [SUP, spec, log], { cwd: SRC, env: process.env, stdio: "ignore", detached: true });
  p.unref();
  fleet.drives[fid] = { finding_id: fid, plan_id: row.plan_id, change_prefix: prefix, spec, log, branch: `fix/${prefix}` };
  console.error(`  ${fid} (${row.plan_id}) → launched [${prefix}]  log: ${log.split("/").pop()}`);
  return "launched";
}

// ── actions
const fleet = loadFleet();
const active = () => Object.values(fleet.drives).filter((d) => !driveState(d).terminal).length;

if (has("--reap")) {
  let n = 0;
  for (const [fid, d] of Object.entries(fleet.drives)) if (driveState(d).terminal) { delete fleet.drives[fid]; n++; }
  saveFleet(fleet); console.error(`[fleet] reaped ${n} terminal drive(s); ${Object.keys(fleet.drives).length} remain tracked.`);
  process.exit(0);
}

if (has("--status")) {
  const rows = [];
  const roll = { done: 0, refuted: 0, halted: 0, running: 0 };
  for (const d of Object.values(fleet.drives)) {
    const st = driveState(d);
    roll[st.terminal || "running"]++;
    let uploaded = 0;
    try { uploaded = execFileSync("bash", ["-lc",
      `git -C ${JSON.stringify(process.env.FIX_TRAINDATA_DIR || "")} log --oneline HEAD 2>/dev/null | grep -ci "data(${d.change_prefix})"`],
      { encoding: "utf8" }).trim(); } catch {}
    rows.push(`  ${d.finding_id.padEnd(6)} ${d.plan_id.padEnd(5)} ${(st.terminal || st.stage).padEnd(14)} uploaded=${uploaded}`);
  }
  console.error(`[fleet] ${Object.keys(fleet.drives).length} tracked | running=${roll.running} done=${roll.done} refuted=${roll.refuted} halted=${roll.halted}`);
  console.error(rows.sort().join("\n"));
  process.exit(0);
}

// --launch N  or  --refill N
const wantLaunch = has("--launch"), wantRefill = has("--refill");
if (!wantLaunch && !wantRefill) { console.error("usage: --launch N | --refill N | --status | --reap"); process.exit(2); }
const N = parseInt(arg("--launch", arg("--refill", "0")), 10) || 0;
const target = wantRefill ? Math.max(0, N - active()) : N;

const q = loadQueue();
const inFleet = new Set(Object.keys(fleet.drives));
const candidates = q.filter((r) => r.status === "pending" && !inFleet.has(r.finding_id)).sort((a, b) => a.rank - b.rank);
console.error(`[fleet] active=${active()} tracked=${inFleet.size} | launching up to ${target} of ${candidates.length} candidate(s)…`);

let launched = 0;
for (const row of candidates) {
  if (launched >= target) break;
  const res = launch(row, fleet);
  saveFleet(fleet);                       // persist after each (crash-safe)
  if (res === "launched") launched++;
}
console.error(`[fleet] launched ${launched} new drive(s); active now ~${active()}. Monitor: node drive_fleet.mjs --status`);
