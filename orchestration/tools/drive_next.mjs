#!/usr/bin/env node
// drive_next.mjs — advance the fix-pipeline intake queue by ONE drive. Designed to be the body of `/loop`:
// each tick it (1) reconciles any in-flight drive against its log/manifest, (2) if none is in flight, picks the
// next PENDING, dependency-unblocked finding by rank, (3) preflights it (pure --drive --plan), and — only with
// --go and when prerequisites are met — (4) runs --intake (which itself refuses findings already fixed by a
// merged PR) and launches drive_supervisor.sh detached. One drive at a time; safe to call repeatedly.
//
//   node drive_next.mjs                 # DRY: reconcile + show the next finding + print the exact launch cmds
//   node drive_next.mjs --go            # LAUNCH the next drive in the background (if prereqs met, none in flight)
//   node drive_next.mjs --status        # just print the queue rollup and any in-flight drive, do nothing else
//
// Prereqs for --go: FIX_TRAINDATA_DIR = a writable git clone (capture is fail-closed); `claude` on PATH (the
// stage driver); GIT_TOKEN (freshness gate + PR open). Missing prereqs => it reports and does NOT launch.
//
// Config (env or flags): --repo <owner/name> --repo-path <clone> --audit-file <path> --base <ref> --queue <file>.
// Defaults target the aiv-protocol 2026-06-18 forensic corpus.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));                 // .../orchestration/tools
const SRC  = join(HERE, "..", "src");
const PIPE = join(SRC, "fix_pipeline.mjs");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const QUEUE      = arg("--queue", join(SRC, "queue.jsonl"));
const REPO_FULL  = arg("--repo", "Black-Box-Research-Labs/aiv-protocol");
const REPO_PATH  = arg("--repo-path", "/home/user/aiv-protocol");
const AUDIT_FILE = arg("--audit-file", "docs/audits/2026-06-18-forensic/02-static-audit.md");
const BASE       = arg("--base", "origin/main");
const LOG_DIR    = arg("--log-dir", join(HERE, "..", "src", "fix", ".work", "logs"));
const TD         = process.env.FIX_TRAINDATA_DIR || "";
const DONE = new Set(["fixed", "done", "refuted"]);                  // statuses that satisfy a dependency

// Ephemeral in-flight state (which finding is driving + its absolute log/spec paths) lives in a gitignored
// sidecar under .work/, NOT the tracked queue — so a live drive never churns machine-specific paths or a
// transient "driving" status into orchestration/src/queue.jsonl. The queue carries only DURABLE dispositions.
const RUNTIME = join(SRC, "fix", ".work", "drive-runtime.json");
const loadRt = () => { try { return existsSync(RUNTIME) ? JSON.parse(readFileSync(RUNTIME, "utf8")) : {}; } catch { return {}; } };
const saveRt = (rt) => { try { mkdirSync(dirname(RUNTIME), { recursive: true }); writeFileSync(RUNTIME, JSON.stringify(rt, null, 2)); } catch {} };
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

if (!existsSync(QUEUE)) { console.error(`[drive-next] no queue at ${QUEUE} — run gen_queue.mjs first.`); process.exit(2); }
const rows = readFileSync(QUEUE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const saveQueue = () => writeFileSync(QUEUE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const planStatus = () => Object.fromEntries(rows.map((r) => [r.plan_id, r.status]));

// ── reconcile: resolve a "driving" row from its supervisor log (primary) + traindata manifest (corroboration).
function terminalFromLog(logPath) {
  if (!logPath || !existsSync(logPath)) return null;
  let t = readFileSync(logPath, "utf8");
  // The supervisor APPENDS across attempts/resumes, so a prior attempt's HALT text lingers. Scope detection to
  // the LATEST supervisor run only (after its "START detached pid=" banner) — else a resumed drive that is still
  // running reads as halted off a stale marker.
  const i = t.lastIndexOf("START detached pid=");
  if (i >= 0) t = t.slice(i);
  if (/finding REFUTED \(exit 5\)/.test(t)) return "refuted";          // successful terminal — defect not present
  if (/DONE — H2 resolved|SPINE COMPLETE/.test(t)) return "done";      // PR parked at H2 (awaiting human merge)
  if (/fail-closed HALT \(exit 3\)|STOP — FATAL|deterministic gate\/artifact FAIL|exhausted \d+ attempts/.test(t)) return "halted";
  return null;                                                         // still running
}
function terminalFromManifest(changePrefix) {
  if (!TD || !changePrefix) return null;
  const mf = join(TD, "drives", String(changePrefix).toLowerCase(), "manifest.json");
  if (!existsSync(mf)) return null;
  try { const m = JSON.parse(readFileSync(mf, "utf8")); return m.terminal || null; } catch { return null; }
}
function reconcile() {
  const rt = loadRt(); let rtChanged = false, qChanged = false;
  for (const [fid, info] of Object.entries(rt)) {
    const term = terminalFromLog(info.log) || (terminalFromManifest(info.change_prefix) ? "done" : null);
    if (!term) continue;                                     // still running — leave the in-flight marker
    const r = rows.find((x) => x.finding_id === fid);
    if (r && (r.status === "pending" || r.status === "driving")) {
      r.status = term === "done" ? "done" : term === "refuted" ? "refuted" : "halted";
      r.terminal = terminalFromManifest(info.change_prefix) || term;
      for (const k of ["drive_log", "spec_file", "drive_started", "reconciled_at"]) delete r[k];   // scrub legacy transient fields
      qChanged = true;
      console.error(`[drive-next] reconciled ${r.plan_id}/${fid}: ${r.status}` +
        (r.status === "halted" ? " (needs attention — see log)" : ""));
    }
    delete rt[fid]; rtChanged = true;                        // drive reached terminal → drop the in-flight marker
  }
  if (rtChanged) saveRt(rt);
  if (qChanged) saveQueue();
}

// ── PR reconciliation: GitHub is the source of truth for what's already been driven. Each tick, match every
// pending/inflight finding against the repo's PRs (by finding-id token in the head ref or title, like the
// pipeline's own freshnessGate) and set: merged PR → "fixed" (do not re-drive), open PR → "inflight" (driven,
// awaiting human merge — do NOT drive a duplicate; the pipeline itself only WARNS on this, so we enforce it).
async function reconcilePrs() {
  const token = process.env.GIT_TOKEN;
  if (!token) { console.error(`[drive-next] GIT_TOKEN unset — GitHub PR reconcile SKIPPED (open-PR findings won't be auto-skipped).`); return; }
  let prs;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_FULL}/pulls?state=all&per_page=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!res.ok) { console.error(`[drive-next] GitHub ${res.status} — PR reconcile skipped (proceeding on local status).`); return; }
    prs = await res.json();
  } catch (e) { console.error(`[drive-next] PR query failed (${String(e).slice(0, 60)}) — reconcile skipped.`); return; }
  let changed = false;
  for (const r of rows) {
    if (!["pending", "inflight"].includes(r.status)) continue;
    const num = String(r.finding_id).replace(/^[Ff]/, "");
    if (!/^\d+$/.test(num)) continue;
    const re = new RegExp(`(^|[^a-z0-9])f${num}([^0-9]|$)`, "i");   // token match, so F1 ≠ F14 (no lookbehind needed)
    const match = prs.find((p) => re.test(`${(p.head && p.head.ref) || ""} ${p.title || ""}`));
    if (!match) continue;
    const merged = !!match.merged_at;
    const ns = merged ? "fixed" : "inflight";
    if (r.status === ns) continue;
    r.status = ns; r.pr = match.number; r.pr_state = merged ? "merged" : "open";
    r.triage = `${merged ? "merged" : "OPEN"} PR #${match.number} (${(match.head && match.head.ref) || "?"}) — ` +
      (merged ? "already fixed" : "driven, awaiting human merge; do NOT re-drive");
    changed = true;
    console.error(`[drive-next] PR-reconcile ${r.plan_id}/${r.finding_id} → ${ns} (PR #${match.number} ${merged ? "merged" : "open"})`);
  }
  if (changed) saveQueue();
}

function inFlight() {                                        // a drive whose sidecar marker hasn't been cleared
  const rt = loadRt(); const fid = Object.keys(rt)[0];
  if (!fid) return null;
  const r = rows.find((x) => x.finding_id === fid) || {};
  return { finding_id: fid, plan_id: r.plan_id || "?", log: rt[fid].log, started: rt[fid].started };
}
function isBlocked(r) {
  const ps = planStatus();
  return String(r.depends_on || "").split(",").map((s) => s.trim()).filter(Boolean)
    .some((pid) => !DONE.has(ps[pid]));
}
function pickNext() {
  // Optional target: --finding <F##> or --plan <P##> drives that specific item (if pending); else rank order.
  const want = arg("--finding", null), wantP = arg("--plan", null);
  if (want || wantP) {
    const r = rows.find((x) => (want && x.finding_id === want) || (wantP && x.plan_id === wantP));
    if (!r) { console.error(`[drive-next] target ${want || wantP} not in queue.`); return null; }
    if (r.status !== "pending") { console.error(`[drive-next] target ${r.plan_id}/${r.finding_id} is '${r.status}', not pending — refusing.`); return null; }
    if (isBlocked(r)) console.error(`[drive-next] ⚠ target ${r.plan_id} has unfinished dependencies (${r.depends_on}) — driving anyway per explicit request.`);
    return r;
  }
  return rows.filter((r) => r.status === "pending" && !isBlocked(r))
             .sort((a, b) => a.rank - b.rank)[0] || null;
}

function rollup() {
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  const nf = Object.keys(loadRt()).length; if (nf) by.driving = nf;   // "driving" is sidecar-only, never a queue status
  const order = ["driving", "pending", "inflight", "done", "refuted", "fixed", "halted", "needs-human"];
  return order.filter((k) => by[k]).map((k) => `${k}=${by[k]}`).join("  ");
}

// ── prerequisite check for an actual launch
function prereqs() {
  const problems = [];
  const tdOk = TD && existsSync(TD) && existsSync(join(TD, ".git"));
  if (!tdOk) problems.push(`FIX_TRAINDATA_DIR not a git clone (capture is fail-closed): ${TD || "(unset)"}`);
  let claudeOk = false;
  try { execFileSync("bash", ["-lc", "command -v claude"], { stdio: "ignore" }); claudeOk = true; } catch {}
  if (!claudeOk) problems.push(`\`claude\` not on PATH (the stage driver) — a drive would HALT without it`);
  if (!process.env.GIT_TOKEN) problems.push(`GIT_TOKEN unset — freshness gate skipped + PR-open (stage 8) will fail`);
  return { ok: problems.length === 0, problems, claudeOk, tdOk };
}

// ── intake + launch one finding (only under --go with prereqs met)
function launch(r) {
  const prefix = r.change_prefix || `aiv-${String(r.finding_id).toLowerCase()}`;
  const intakeArgs = ["--intake", "--finding-id", r.finding_id, "--repo", r.repo_full || REPO_FULL,
    "--repo-path", REPO_PATH, "--audit-file", AUDIT_FILE, "--change-prefix", prefix, "--base", BASE];
  if (r.goal_condition) intakeArgs.push("--goal", r.goal_condition);
  console.error(`[drive-next] intake ${r.finding_id} (${prefix}) …`);
  let out = "";
  try {
    out = execFileSync("node", [PIPE, ...intakeArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = String(e.stderr || e.stdout || e.message || "");
    if (/REFUSING .*MERGED PR already fixes it/.test(err)) {          // freshness gate: already fixed upstream
      r.status = "fixed"; r.triage = "merged PR already fixes it (freshness gate)"; saveQueue();
      console.error(`[drive-next] ${r.finding_id}: already fixed by a merged PR — marked fixed, skipping.`);
      return { skipped: true };
    }
    console.error(`[drive-next] intake FAILED for ${r.finding_id}:\n${err.slice(-600)}`);
    return { error: true };
  }
  const m = (out + "\n").match(/--drive --spec (\S+)/) ||
            [null, join(SRC, "fix", ".work", `spec_${r.finding_id}.json`)];
  const specFile = m[1];
  if (!existsSync(specFile)) { console.error(`[drive-next] spec not found after intake: ${specFile}`); return { error: true }; }
  execFileSync("bash", ["-lc", `mkdir -p ${JSON.stringify(LOG_DIR)}`]);
  const logFile = join(LOG_DIR, `${prefix}.log`);
  const sup = spawn("bash", [join(SRC, "drive_supervisor.sh"), specFile, logFile],
    { cwd: SRC, env: process.env, stdio: "ignore", detached: true });
  sup.unref();
  const rt = loadRt();                                       // record in-flight ONLY in the gitignored sidecar
  rt[r.finding_id] = { plan_id: r.plan_id, change_prefix: prefix, log: logFile, spec: specFile, started: nowIso() };
  saveRt(rt);                                                // queue row stays 'pending' until reconcile records a durable terminal
  console.error(`[drive-next] LAUNCHED ${r.plan_id}/${r.finding_id} → supervisor detached; log: ${logFile}`);
  return { launched: true, logFile };
}

// ─────────────────────────────────────────────────────────────────────────────
reconcile();                 // in-flight drives → done/refuted/halted (from supervisor log + manifest)
await reconcilePrs();        // GitHub truth: pending → fixed (merged) / inflight (open PR)
console.error(`[drive-next] queue: ${rollup()}`);

const flying = inFlight();
if (flying) {
  console.error(`[drive-next] IN FLIGHT: ${flying.plan_id}/${flying.finding_id} (since ${flying.started || "?"}) — log: ${flying.log}`);
  console.error(`[drive-next] one drive at a time; nothing to start. (Tail the log to watch it.)`);
  process.exit(0);
}
if (has("--status")) process.exit(0);

const next = pickNext();
if (!next) {
  const pend = rows.filter((r) => r.status === "pending").length;
  console.error(pend ? `[drive-next] ${pend} pending but all are blocked by unfinished dependencies — nothing runnable.`
                     : `[drive-next] queue drained — no pending findings. Stop the loop.`);
  process.exit(0);
}

console.error(`[drive-next] NEXT: #${next.rank} ${next.plan_id} → ${next.finding_id} [${next.severity || "?"}] ${next.location}`);
console.error(`[drive-next]   goal: ${String(next.goal_condition).slice(0, 140)}`);
// pure preflight — prints the queue row + resume cursor, no side effects
try {
  const pf = execFileSync("node", [PIPE, "--drive", "--plan", "--finding-id", next.finding_id, "--repo-short", next.repo],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  process.stderr.write(pf.split("\n").filter((l) => l.includes("[drive")).map((l) => "    " + l).join("\n") + "\n");
} catch (e) { console.error(`    (preflight note: ${String(e.message).slice(0, 80)})`); }

const pr = prereqs();
if (!has("--go")) {
  console.error(`[drive-next] DRY RUN — not launching. To drive it:`);
  console.error(`    node ${PIPE} --intake --finding-id ${next.finding_id} --repo ${next.repo_full || REPO_FULL} \\`);
  console.error(`         --repo-path ${REPO_PATH} --audit-file ${AUDIT_FILE} --change-prefix ${next.change_prefix} --base ${BASE}`);
  console.error(`    bash ${join(SRC, "drive_supervisor.sh")} <spec-from-intake> <log>`);
  console.error(`    …or just: node ${fileURLToPath(import.meta.url)} --go`);
  if (!pr.ok) console.error(`[drive-next] prereqs for --go NOT met:\n` + pr.problems.map((p) => "    - " + p).join("\n"));
  process.exit(0);
}
if (!pr.ok) {
  console.error(`[drive-next] --go given but prerequisites are NOT met; refusing to launch (a drive would HALT):`);
  console.error(pr.problems.map((p) => "    - " + p).join("\n"));
  process.exit(1);
}
launch(next);
