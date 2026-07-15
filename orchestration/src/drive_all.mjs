#!/usr/bin/env node
/**
 * drive_all.mjs — the fleet loop over a specgen drive-order.
 *
 * `fix_pipeline.mjs --drive` drives ONE finding; `drive_supervisor.sh` keeps ONE long drive alive. Neither
 * drives a WHOLE queue in dependency order. This does: it reads a `drive-order.json` (from specgen_from_audit),
 * walks it in topological (depends_on) order, and drives each ready spec through `fix_pipeline.mjs --drive`,
 * skipping goal/non-ready items and anything blocked by a dependency that did not COMPLETE. It is resumable
 * (state.json keyed by plan id) and honest: a HALT/REFUTE stops that lineage, it never force-passes.
 *
 * Terminal-state mapping (fix_pipeline.mjs exit codes): 0=complete, 3=halted, 4=gate_fail, 5=refuted.
 * A dependency counts as satisfied ONLY when it reached `complete` — a halted/refuted dep blocks its dependents.
 *
 * Usage:
 *   node drive_all.mjs --order <drive-order.json> --specs <dir> --cwd <worktree> \
 *        [--pipeline <fix_pipeline.mjs>] [--state <fleet-state.json>] [--from <PID>] [--only <PID,PID>] \
 *        [--include-nonready] [--dry-run [--stub-halt PID,PID]]
 *   node drive_all.mjs --selftest            # zero-spawn: exercise the decide() planner (0 failed is the gate)
 *
 * --dry-run does not spawn drives; it plans + simulates outcomes (all complete unless --stub-halt), so you can
 * see exactly what WOULD run and how a halt cascades to dependents before spending real drives.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const has = (n) => argv.includes(n);

// ── pure planner (selftested) ─────────────────────────────────────────────────────────────────────
// Decide what to do with one drive-order row given the fleet state so far. Pure: (row, state, opts) -> decision.
//   state[planId] = "complete" | "halted" | "gate_fail" | "refuted" | "error" | "running"
// Order of checks matters: already-terminal first (resume), then readiness, then dependency gate.
function decide(row, state, opts = {}) {
  const id = row.plan_id;
  const st = state[id];
  if (st && st !== "running") return { id, action: "skip", reason: `already ${st}` };
  if (opts.only && !opts.only.includes(id)) return { id, action: "skip", reason: "not in --only" };
  if (opts.fromReached === false) return { id, action: "skip", reason: `before --from ${opts.from}` };
  if (!row.drivable_now && !opts.includeNonready) return { id, action: "skip", reason: "not drivable_now (goal/needs-oracle)" };
  const unmet = (row.depends_on || []).filter((d) => state[d] !== "complete");
  if (unmet.length) return { id, action: "skip", reason: `blocked by ${unmet.join(",")} (not complete)` };
  return { id, action: "drive", reason: "ready" };
}
const EXIT_STATE = { 0: "complete", 3: "halted", 4: "gate_fail", 5: "refuted" };
const codeToState = (code) => EXIT_STATE[code] || "error";

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; if (!ok) console.error(`  FAIL ${n}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const R = (p, deps = [], drivable = true) => ({ plan_id: p, depends_on: deps, drivable_now: drivable });
  eq("ready no deps", decide(R("P01"), {}), { id: "P01", action: "drive", reason: "ready" });
  eq("blocked by incomplete dep", decide(R("P08", ["P06"]), {}).action, "skip");
  eq("unblocked when dep complete", decide(R("P08", ["P06"]), { P06: "complete" }).action, "drive");
  eq("dep halted still blocks", decide(R("P08", ["P06"]), { P06: "halted" }).action, "skip");
  eq("resume skips complete", decide(R("P01"), { P01: "complete" }).reason, "already complete");
  eq("resume redrives running", decide(R("P01"), { P01: "running" }).action, "drive");
  eq("non-ready skipped by default", decide(R("P41", [], false), {}).action, "skip");
  eq("non-ready driven with flag", decide(R("P41", [], false), {}, { includeNonready: true }).action, "drive");
  eq("only filter", decide(R("P02"), {}, { only: ["P05"] }).action, "skip");
  eq("from not reached", decide(R("P02"), {}, { fromReached: false, from: "P05" }).action, "skip");
  eq("exit code map", [0, 3, 4, 5, 9].map(codeToState), ["complete", "halted", "gate_fail", "refuted", "error"]);
  console.log(`selftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
function main() {
  if (has("--selftest")) return selftest();
  const orderPath = getArg("--order"), specsDir = getArg("--specs"), cwd = getArg("--cwd");
  const pipeline = getArg("--pipeline", join(dirname(new URL(import.meta.url).pathname), "fix_pipeline.mjs"));
  const dryRun = has("--dry-run");
  const only = getArg("--only") ? String(getArg("--only")).split(",").map((s) => s.trim()) : null;
  const from = getArg("--from", null);
  const includeNonready = has("--include-nonready");
  const stubHalt = getArg("--stub-halt") ? new Set(String(getArg("--stub-halt")).split(",").map((s) => s.trim())) : new Set();
  const missing = [["--order", orderPath], ["--specs", specsDir]].filter(([, v]) => !v).map(([k]) => k);
  if (!dryRun && !cwd) missing.push("--cwd");
  if (missing.length) { console.error(`[drive_all] missing: ${missing.join(", ")} (or run --selftest)`); process.exit(2); }
  if (!existsSync(orderPath)) { console.error(`[drive_all] --order not found: ${orderPath}`); process.exit(2); }

  const order = JSON.parse(readFileSync(orderPath, "utf8")).order || [];
  const statePath = getArg("--state", join(specsDir, "fleet-state.json"));
  // dry-run is a clean simulation: never load or persist real fleet state (else consecutive dry-runs resume
  // each other and --stub-halt can't show the cascade). Only real drives touch state.json.
  const state = (!dryRun && existsSync(statePath)) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  const saveState = () => { if (dryRun) return; mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); };

  let fromReached = from ? false : true;
  const log = [];
  for (const row of order) {
    if (from && row.plan_id === from) fromReached = true;
    const d = decide(row, state, { only, includeNonready, fromReached, from });
    if (d.action === "skip") { log.push(`  skip  ${row.plan_id}/${row.finding_id}  — ${d.reason}`); continue; }

    const specPath = join(specsDir, row.spec_file);
    if (!existsSync(specPath) && !dryRun) { state[row.plan_id] = "error"; log.push(`  ERROR ${row.plan_id} — spec missing: ${specPath}`); saveState(); continue; }

    let outcome;
    if (dryRun) {
      outcome = stubHalt.has(row.plan_id) ? "halted" : "complete";           // simulate to show cascade
      log.push(`  DRIVE ${row.plan_id}/${row.finding_id}  (dry-run → ${outcome})  spec=${row.spec_file}`);
    } else {
      state[row.plan_id] = "running"; saveState();
      console.error(`[drive_all] driving ${row.plan_id}/${row.finding_id} …`);
      const r = spawnSync("node", [pipeline, "--drive", "--spec", specPath, "--cwd", cwd], { stdio: "inherit", env: process.env });
      outcome = r.error ? "error" : codeToState(r.status);
      log.push(`  ${outcome === "complete" ? "DONE " : "STOP "} ${row.plan_id}/${row.finding_id} → ${outcome} (exit ${r.status})`);
    }
    state[row.plan_id] = outcome;
    saveState();
    // Real mode: a halt/refute is a genuine issue for human attention — surface it, keep driving independent
    // lineages (dependents are auto-skipped by decide()'s dependency gate on the next iterations).
  }

  console.log(log.join("\n"));
  const tally = {};
  for (const row of order) { const s = state[row.plan_id] || "skipped"; tally[s] = (tally[s] || 0) + 1; }
  console.log(`\n[drive_all] ${dryRun ? "(dry-run) " : ""}tally: ${JSON.stringify(tally)}`);
  console.log(`[drive_all] state → ${statePath}`);
}

main();
