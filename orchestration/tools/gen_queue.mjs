#!/usr/bin/env node
// gen_queue.mjs — build the fix-pipeline intake queue (queue.jsonl) from an AIV forensic corpus.
//
// The fix pipeline drives ONE finding per drive and reads its ratified worklist from
// orchestration/src/queue.jsonl (queueRow() in fix_pipeline.mjs). Nothing populated that queue for the
// aiv-protocol self-audit, so this generator emits it from the corpus's own deduplicated, dependency-ordered
// 79-item remediation plan (05-plan.md) — NOT the 251 raw findings (which over-count 10:1).
//
// For each plan item it:
//   • picks a REPRESENTATIVE finding id (F##) — the first links_to id that exists as a row in
//     02-static-audit.md, so `materializeFinding`/`auditTableRow` can resolve its Class-E intent row;
//   • seeds goal_condition from the plan item's Verification field (the acceptance test — the oracle seed);
//   • namespaces the drive id (change_prefix = "aiv-f##") so the training corpus never collides with
//     another repo's F## (e.g. black-box's F43 ≠ aiv-protocol's F43);
//   • marks status = "fixed" for items already remediated (detected from the target repo's git log +
//     FINDINGS.md ✅ markers) so /loop skips them, "needs-human" for non-converged plan items, else "pending".
//
// The queue is advisory to the pipeline (only finding_id/repo/location/goal_condition are consumed by
// materializeFinding); rank/status/plan_id/depends_on/change_prefix are for the /loop driver (drive_next.mjs).
//
// Usage:
//   node gen_queue.mjs [--audit-dir <dir>] [--repo-short aiv-protocol] [--repo <owner/name>]
//                      [--repo-path <clone>] [--out <queue.jsonl>] [--base origin/main] [--stdout]
// Defaults target the aiv-protocol 2026-06-18 forensic corpus.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));            // .../orchestration/tools
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const REPO_PATH  = arg("--repo-path", "/home/user/aiv-protocol");
const AUDIT_DIR  = arg("--audit-dir", join(REPO_PATH, "docs/audits/2026-06-18-forensic"));
const REPO_SHORT = arg("--repo-short", "aiv-protocol");
const REPO_FULL  = arg("--repo", "Black-Box-Research-Labs/aiv-protocol");
const BASE       = arg("--base", "origin/main");
const OUT        = arg("--out", join(HERE, "..", "src", "queue.jsonl"));
const PREFIX_NS  = REPO_SHORT === "aiv-protocol" ? "aiv" : REPO_SHORT;  // drive-id namespace

const planPath  = join(AUDIT_DIR, "05-plan.md");
const auditPath = join(AUDIT_DIR, "02-static-audit.md");
const findPath  = join(AUDIT_DIR, "FINDINGS.md");
for (const p of [planPath, auditPath]) if (!existsSync(p)) { console.error(`[gen-queue] missing: ${p}`); process.exit(2); }

// ── 1. Parse the plan's fenced ```json block: { items:[{id,change,links_to,location,verification,depends_on}], ... }
function extractFencedJson(md) {
  const m = md.match(/```json\s*([\s\S]*?)```/);
  if (!m) { console.error("[gen-queue] no ```json block in 05-plan.md"); process.exit(2); }
  try { return JSON.parse(m[1]); } catch (e) { console.error(`[gen-queue] plan JSON parse error: ${e}`); process.exit(2); }
}
const planDoc = extractFencedJson(readFileSync(planPath, "utf8"));
const items = planDoc.items || [];
const notConverged = new Set([...(planDoc.not_converged || []), ...(planDoc._ambiguous || [])]);
if (!items.length) { console.error("[gen-queue] plan has no items[]"); process.exit(2); }

// ── 2. Parse the 02-static-audit.md findings TABLE by column NAME (mirrors auditTableRow's tolerance to
//       per-repo column order): header row -> {colName: idx}, then every `| F## | ... |` row -> fields.
function parseAuditTable(md) {
  const lines = md.split("\n");
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const table = {};
  let hdr = null;
  for (let i = 0; i < lines.length; i++) {
    if (!hdr && i > 0 && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
      const cells = lines[i - 1].split("|");
      const map = {};
      cells.forEach((h, idx) => {
        const n = norm(h);
        if (["id", "finding", "findingid"].includes(n)) map.id ??= idx;
        else if (["sev", "severity"].includes(n)) map.severity ??= idx;
        else if (["status", "verified", "verification"].includes(n)) map.status ??= idx;
        else if (["location", "file", "path"].includes(n)) map.location ??= idx;
        else if (["class", "category", "type"].includes(n)) map.category ??= idx;
        else if (["title", "evidence", "description", "summary", "details"].includes(n)) map.description ??= idx;
      });
      if (map.id !== undefined) hdr = map;
    }
    const rm = lines[i].match(/^\|\s*([A-Za-z0-9_.-]+)\s*\|/);
    if (rm && /^F\d+$/.test(rm[1]) && hdr) {
      const c = lines[i].split("|").map((x) => x.trim());
      const at = (idx) => (idx === undefined ? "" : (c[idx] || "").trim());
      table[rm[1]] = { severity: at(hdr.severity).toLowerCase(), location: at(hdr.location), category: at(hdr.category) };
    }
  }
  return table;
}
const audit = parseAuditTable(readFileSync(auditPath, "utf8"));
if (!Object.keys(audit).length) console.error("[gen-queue] WARNING: parsed 0 rows from 02-static-audit.md");

// ── 3. Fixed-set: findings already remediated. Two reproducible signals, unioned:
//   (a) the target repo's git log — F-ids named in fix/remediation commit subjects on the base branch;
//   (b) FINDINGS.md — Raw IDs of any ### section marked "✅ FIXED" / "Remediation: ✅".
function gitFixedSet() {
  const out = new Set();
  try {
    const log = execFileSync("git", ["-C", REPO_PATH, "log", "--pretty=%s", BASE.replace(/^origin\//, "")], { encoding: "utf8" });
    for (const line of log.split("\n")) {
      if (!/fix|remediat/i.test(line)) continue;
      for (const m of line.matchAll(/\bF\d+\b/g)) out.add(m[0]);
    }
  } catch (e) { console.error(`[gen-queue] git-log fixed-set skipped (${String(e).slice(0, 80)})`); }
  return out;
}
function findingsMdFixedSet() {
  const out = new Set();
  if (!existsSync(findPath)) return out;
  const md = readFileSync(findPath, "utf8");
  // PRECISE: only ### prose sections (C1/C2-style) that carry an explicit "Remediation: ✅ FIXED" marker, and
  // then only the F-ids on that section's "Raw IDs:" line. This deliberately does NOT sweep the High-severity
  // TABLES: a single "✅ fixed" cell (e.g. H12/H3c) must not mark its table-neighbours (H1/H2/H4) as fixed.
  // git-log catches the table-level fixes (F113/F210) separately.
  const sections = md.split(/\n(?=###\s)/);
  for (const sec of sections) {
    if (!/Remediation:\s*✅|✅\s*FIXED/i.test(sec)) continue;
    const raw = sec.match(/\*\*Raw IDs:\*\*\s*([^\n]+)/i) || sec.match(/Raw IDs:\s*([^\n]+)/i);
    if (!raw) continue;
    for (const m of raw[1].matchAll(/\bF\d+\b/g)) out.add(m[0]);
  }
  return out;
}
const fixedSet = new Set([...gitFixedSet(), ...findingsMdFixedSet()]);

// ── 4. Emit one queue row per plan item (rank = plan order = security-first).
const rows = [];
const counts = { pending: 0, fixed: 0, "needs-human": 0 };
items.forEach((it, idx) => {
  const links = String(it.links_to || "").split(",").map((s) => s.trim()).filter((s) => /^F\d+$/.test(s));
  const rep = links.find((f) => audit[f]) || links[0] || `P-${it.id}`;
  const fixed = links.some((f) => fixedSet.has(f));
  const status = notConverged.has(it.id) ? "needs-human" : fixed ? "fixed" : "pending";
  counts[status]++;
  const fixedBy = links.filter((f) => fixedSet.has(f));
  rows.push({
    finding_id: rep,
    plan_id: it.id,
    repo: REPO_SHORT,                                   // queueRow matches on the SHORT name
    repo_full: REPO_FULL,                               // --repo for materializeFinding
    severity: (audit[rep] && audit[rep].severity) || "",
    category: (audit[rep] && audit[rep].category) || "",
    location: (audit[rep] && audit[rep].location) || it.location || "",   // finding bug-site (SEAM revert target)
    fix_location: it.location || "",                                      // plan's full touched-file scope
    goal_condition: String(it.verification || "").trim(),  // the oracle seed (plan Verification)
    change_prefix: `${PREFIX_NS}-${String(rep).toLowerCase()}`,   // namespaced drive id
    links_to: it.links_to || "",
    depends_on: it.depends_on || "",                    // comma-separated P## (driver resolves via plan_id)
    rank: idx + 1,
    status,
    triage: status === "fixed" ? `already remediated (F-ids ${fixedBy.join(",")} in git log / FINDINGS.md)`
          : status === "needs-human" ? "plan item did not converge — human decision required (see 05-plan.md)"
          : "not yet driven",
    change: String(it.change || "").replace(/\s+/g, " ").trim(),
  });
});

// ── 5. Write JSONL (or --stdout) + a summary.
const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
if (has("--stdout")) process.stdout.write(jsonl);
else { writeFileSync(OUT, jsonl); console.error(`[gen-queue] wrote ${rows.length} rows -> ${OUT}`); }

console.error(`[gen-queue] ${rows.length} items | pending=${counts.pending} fixed=${counts.fixed} needs-human=${counts["needs-human"]}`);
const nextUp = rows.filter((r) => r.status === "pending").slice(0, 8);
console.error(`[gen-queue] next up (by rank):`);
for (const r of nextUp) console.error(`  #${String(r.rank).padStart(2)} ${r.plan_id} → ${r.finding_id} [${r.severity || "?"}] ${r.location}`);
if (counts.fixed) console.error(`[gen-queue] skipping ${counts.fixed} already-fixed: ` +
  rows.filter((r) => r.status === "fixed").map((r) => `${r.plan_id}/${r.finding_id}`).join(", "));
