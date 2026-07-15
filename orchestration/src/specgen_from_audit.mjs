#!/usr/bin/env node
/**
 * specgen_from_audit.mjs — the missing PRODUCER for the fix-pipeline queue.
 *
 * The spine (`fix_pipeline.mjs --drive --spec <f.json>`) consumes a per-finding spec, and
 * `specFromRow()` reads those straight off a ratified `queue.jsonl` row — but nothing BUILDS that
 * queue from an audit corpus. This does: it joins a forensic audit's Stage-2 findings
 * (`02-findings.json`) with the Stage-5 remediation plan (`05-plan.json`) into ready-to-drive specs.
 *
 * The join is the point:
 *   - the FINDING supplies the Class-E intent anchor  (intentSource = 02 file, intentLine, bugSite)
 *   - the PLAN item supplies the machine oracle        (goalCondition = verification_signal)
 *                                and the drive ORDER   (depends_on -> topological drive sequence)
 * A plan item is one unit of work = one PR = one drive; it may cover several findings (links_to).
 *
 * Emits (into --out):
 *   spec_<id>.json      one canonical spec per drivable unit (fields identical to specFromRow/loadSpec)
 *   queue.jsonl         harness-native rows {finding_id, repo, location, goal_condition, ...}
 *   drive-order.json    topologically-sorted manifest (depends_on then plan order) + drivability flags
 *   SPECGEN_REPORT.md   human summary: counts, ordered drive list, oracle-quality, uncovered findings
 *
 * Usage:
 *   node specgen_from_audit.mjs --findings <02-findings.json> --plan <05-plan.json> \
 *        --audit-md <02-static-audit.md> --repo <owner/repo> [--base origin/main] \
 *        [--out ./specs] [--unit plan|finding] [--tag <prefix>]
 *   node specgen_from_audit.mjs --selftest      # zero-input: exercise the pure helpers (0 failed is the gate)
 *
 * No dependencies. Pure helpers are unit-tested by --selftest, mirroring fix_pipeline.mjs discipline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };

// ── pure helpers (selftested) ─────────────────────────────────────────────────────────────────────
// Tolerant JSON: strips a BOM and an optional ```json fence (the aiv guard wraps raw JSON as .json.md).
function tolerantJson(s) {
  try { return JSON.parse(s); }
  catch { return JSON.parse(String(s).replace(/^﻿/, "").replace(/^```(json)?/i, "").replace(/```\s*$/, "").trim()); }
}
// Kebab slug for change-ids/branches. aiv lowercases + maps '-'/'_' internally; keep it short + clean.
function slug(s, max = 40) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}
// First path token of a possibly-compound location ("`a.py:1` + `b.py:2`" -> "a.py:1"); backticks stripped.
function firstSite(location) {
  const raw = String(location || "").split(/\s*\+\s*/)[0] || "";
  return raw.replace(/`/g, "").trim() || null;
}
// links_to is either "F1,F2,F3" (audit findings) or "GOAL: … | research: …" (Stage-5 goal items, no finding).
function parseLinks(links_to) {
  const s = String(links_to || "").trim();
  if (/^GOAL\b/i.test(s) || !/F\d/i.test(s)) return { goal: true, findings: [] };
  const fs = (s.match(/F\d+/gi) || []).map((x) => x.toUpperCase());
  return { goal: fs.length === 0, findings: [...new Set(fs)] };
}
// 1-based line of a finding's row in the rendered 02-static-audit.md table ("| F15 | …"). null if absent.
function intentLineOf(mdText, findingId) {
  if (!mdText || !findingId) return null;
  const re = new RegExp(`^\\|\\s*${findingId}\\s*\\|`, "i");
  const lines = String(mdText).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}
// Classify a verification_signal by how close it is to a MACHINE oracle the fix-pipeline can grade.
//   machine = names an exit code / match count / grep outcome (ready to become goal_condition as-is)
//   pytest  = names a test/assertion (a runnable pytest node is one authoring step away)
//   prose   = an observation with no mechanical check yet (operator must sharpen it into a command)
function classifyGoal(vs) {
  const s = String(vs || "").toLowerCase();
  if (!s.trim()) return "empty";
  if (/\bexit(\s*code)?\s*\b(0|non-?zero)|non-?zero\b|zero hits|>=\s*\d|\b\d+\s+(match|hit)|grep\b|returns?\s+(true|false|0|1|exit)/.test(s)) return "machine";
  if (/\b(test|assert|pytest|unit test|@pytest)\b/.test(s)) return "pytest";
  return "prose";
}
const SEV = ["critical", "high", "medium", "low"];
const sevRank = (s) => { const i = SEV.indexOf(String(s || "").toLowerCase()); return i < 0 ? 99 : i; };
const maxSeverity = (sevs) => sevs.slice().sort((a, b) => sevRank(a) - sevRank(b))[0] || "low";
// Kahn topological sort of plan items by depends_on (edges point to prerequisites); tie-break by `order`.
// Any node in an unresolved cycle is appended in `order` sequence with a flagged cycle (never dropped).
function topoSort(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const indeg = new Map(items.map((it) => [it.id, 0]));
  const deps = new Map(items.map((it) => [it.id, (it.depends_on || []).filter((d) => byId.has(d))]));
  for (const it of items) for (const d of deps.get(it.id)) indeg.set(it.id, indeg.get(it.id) + 1);
  const ready = items.filter((it) => indeg.get(it.id) === 0).sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [], seen = new Set();
  while (ready.length) {
    const it = ready.shift(); if (seen.has(it.id)) continue; seen.add(it.id); out.push(it);
    const unblocked = items.filter((c) => !seen.has(c.id) && deps.get(c.id).every((d) => seen.has(d)));
    for (const c of unblocked) if (!ready.includes(c)) ready.push(c);
    ready.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const cyclic = items.filter((it) => !seen.has(it.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  return { ordered: [...out, ...cyclic], cyclic: cyclic.map((it) => it.id) };
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); (ok ? pass++ : fail++); if (!ok) console.error(`  FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  eq("slug", slug("Track real fix success!"), "track-real-fix-success");
  eq("firstSite compound", firstSite("`src/a.py:1` + `src/b.py:2`"), "src/a.py:1");
  eq("firstSite plain", firstSite("src/x.py:519,538"), "src/x.py:519,538");
  eq("parseLinks findings", parseLinks("F33,F34,F35"), { goal: false, findings: ["F33", "F34", "F35"] });
  eq("parseLinks goal", parseLinks("GOAL: add APR | research: SWE-bench"), { goal: true, findings: [] });
  eq("intentLine hit", intentLineOf("head\n| F15 | critical | bug |\n| F16 | low |", "F15"), 2);
  eq("intentLine miss", intentLineOf("| F1 |", "F99"), null);
  eq("classify machine", classifyGoal("returns exit code 0; a run that fixes none returns non-zero."), "machine");
  eq("classify grep", classifyGoal("Grep for the token returns zero hits."), "machine");
  eq("classify pytest", classifyGoal("Unit test: injecting a CompletionError shows the loop proceeds."), "pytest");
  eq("classify prose", classifyGoal("End-to-end/manual run: a failed gh pr create now yields False."), "prose");
  eq("classify empty", classifyGoal(""), "empty");
  eq("maxSeverity", maxSeverity(["low", "high", "medium"]), "high");
  const ts = topoSort([{ id: "P08", order: 8, depends_on: ["P06"] }, { id: "P06", order: 6, depends_on: [] }, { id: "P05", order: 5, depends_on: [] }]);
  eq("topo order", ts.ordered.map((x) => x.id), ["P05", "P06", "P08"]);
  eq("topo no cycle", ts.cyclic, []);
  const cyc = topoSort([{ id: "A", order: 1, depends_on: ["B"] }, { id: "B", order: 2, depends_on: ["A"] }]);
  eq("topo cycle flagged", cyc.cyclic, ["A", "B"]);
  console.log(`selftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── build one drive unit (plan item -> {spec, meta, row}) ───────────────────────────────────────────
function buildUnit(item, findingsById, opts) {
  const { repo, base, tag, auditFile, auditMd } = opts;
  const { goal, findings } = parseLinks(item.links_to);
  const covered = findings.map((fid) => findingsById[fid]).filter(Boolean);
  const primary = covered[0] || null;                       // Class-E anchor = the first linked finding
  const specId = primary ? primary.id : item.id;            // finding id when finding-backed, else plan id (P41-44)
  const changeIdPrefix = [tag, item.id.toLowerCase(), slug(item.title, 28)].filter(Boolean).join("-");
  const bugSite = firstSite(item.location) || (primary && firstSite(primary.location)) || null;
  const intentLine = primary ? intentLineOf(auditMd, primary.id) : null;
  const goalQuality = classifyGoal(item.verification_signal);
  // "drivable now" = a real machine/pytest oracle at a code site. A prose verification_signal is still
  // drivable (launch-brief must synthesize the machine check), but it needs sharpening first — do NOT
  // count it as ready, or the queue overstates readiness (the failure mode this whole system prevents).
  const drivableNow = !!(bugSite && (goalQuality === "machine" || goalQuality === "pytest") && !goal);
  const severity = covered.length ? maxSeverity(covered.map((f) => f.severity)) : "n/a";

  const spec = {
    id: specId,
    repo,
    cwd: "<override per-run with --cwd>",
    baseBranch: base,
    changeIdPrefix,
    planPath: `.aiv/plans/${changeIdPrefix}-plan.md`,
    intentSource: auditFile,                                // Class E = the AUDIT record (02 file), not the code site
    intentLine,
    bugSite,
    goalCondition: item.verification_signal || null,        // the machine oracle, sourced from the 05-plan
    findingFile: null,                                      // harness intake writes finding_<id>.txt at drive time
    headBranch: `fix/${changeIdPrefix}`,
    title: `${item.id} (${specId}): ${item.title}`,
    _meta: {                                                // ignored by the harness; provenance + operator triage
      plan_id: item.id, covers: findings, severity, effort: item.effort || null,
      depends_on: item.depends_on || [], plan_order: item.order ?? null,
      goal_quality: goalQuality, drivable_now: drivableNow, goal_item: goal,
      change: item.change || null,
    },
  };
  // queue.jsonl row — the ratified-queue shape specFromRow() consumes (repo carried SHORT for reconcile match).
  const row = {
    finding_id: specId, repo: String(repo).split("/").pop(), location: bugSite,
    goal_condition: item.verification_signal || null,
    intent_source: auditFile, intent_line: intentLine,
    plan_id: item.id, change_prefix: changeIdPrefix, covers: findings, depends_on: item.depends_on || [],
    severity, effort: item.effort || null, drivable_now: drivableNow, goal_quality: goalQuality,
  };
  return { spec, row, meta: spec._meta };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
function main() {
  if (argv.includes("--selftest")) return selftest();
  const findingsPath = getArg("--findings"), planPath = getArg("--plan"), auditMdPath = getArg("--audit-md");
  const repo = getArg("--repo"), base = getArg("--base", "origin/main");
  const outDir = getArg("--out", join(process.cwd(), "specs")), tag = getArg("--tag", "fix");
  const auditFile = getArg("--intent-source", "audit/02-static-audit.md");
  const missing = [["--findings", findingsPath], ["--plan", planPath], ["--audit-md", auditMdPath], ["--repo", repo]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { console.error(`[specgen] missing required flags: ${missing.join(", ")}\n  see the header for usage, or run --selftest`); process.exit(2); }
  for (const [f, p] of [["--findings", findingsPath], ["--plan", planPath], ["--audit-md", auditMdPath]])
    if (!existsSync(p)) { console.error(`[specgen] ${f} file not found: ${p}`); process.exit(2); }

  const findingsDoc = tolerantJson(readFileSync(findingsPath, "utf8"));
  const planDoc = tolerantJson(readFileSync(planPath, "utf8"));
  const auditMd = readFileSync(auditMdPath, "utf8");
  const findings = findingsDoc.findings || [];
  const items = planDoc.items || [];
  const findingsById = Object.fromEntries(findings.map((f) => [f.id, f]));
  if (!findings.length || !items.length) { console.error(`[specgen] empty corpus: ${findings.length} findings, ${items.length} plan items`); process.exit(2); }

  const { ordered, cyclic } = topoSort(items);
  const units = ordered.map((it) => buildUnit(it, findingsById, { repo, base, tag, auditFile, auditMd }));

  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^spec_.*\.json$/.test(f)) try { unlinkSync(join(outDir, f)); } catch {} // idempotent regen
  for (const u of units) writeFileSync(join(outDir, `spec_${u.spec._meta.plan_id}_${u.spec.id}.json`), JSON.stringify(u.spec, null, 2) + "\n");
  writeFileSync(join(outDir, "queue.jsonl"), units.map((u) => JSON.stringify(u.row)).join("\n") + "\n");

  // coverage: every finding must be either covered by a plan item, or explicitly listed as uncovered (no silent drop).
  const coveredIds = new Set(units.flatMap((u) => u.row.covers));
  const uncovered = findings.filter((f) => !coveredIds.has(f.id));
  const drivable = units.filter((u) => u.row.drivable_now);
  const needOracle = units.filter((u) => !u.row.drivable_now && !u.spec._meta.goal_item);
  const goalItems = units.filter((u) => u.spec._meta.goal_item);

  const driveOrder = {
    repo, base, intent_source: auditFile, generated_from: { findings: findingsPath, plan: planPath },
    counts: { plan_items: items.length, drivable_now: drivable.length, need_oracle: needOracle.length, goal_research: goalItems.length,
      findings_total: findings.length, findings_covered: coveredIds.size, findings_uncovered: uncovered.length },
    cyclic_depends_on: cyclic,
    order: units.map((u) => ({ seq: null, spec_file: `spec_${u.spec._meta.plan_id}_${u.spec.id}.json`, ...u.row })).map((r, i) => ({ ...r, seq: i + 1 })),
    uncovered_findings: uncovered.map((f) => ({ id: f.id, severity: f.severity, class: f.class, location: f.location })),
  };
  writeFileSync(join(outDir, "drive-order.json"), JSON.stringify(driveOrder, null, 2) + "\n");

  const row = (u, i) => `| ${i + 1} | ${u.spec._meta.plan_id} | ${u.spec.id} | ${u.row.severity} | ${u.row.goal_quality}${u.row.drivable_now ? " ✅" : ""} | \`${u.row.location || "—"}\` | ${(u.spec._meta.depends_on || []).join(",") || "—"} | ${String(u.spec.title).slice(0, 46)} |`;
  const report = [
    `# specgen — drive queue from the audit corpus`, ``,
    `Generated ${units.length} specs from **${findingsPath}** (${findings.length} findings) + **${planPath}** (${items.length} plan items).`,
    `Target repo: \`${repo}\` · base \`${base}\` · intent source \`${auditFile}\`.`, ``,
    `## Drivability`, ``,
    `- **${drivable.length}** drivable now (machine/pytest oracle + code site) — start here.`,
    `- **${needOracle.length}** need a sharpened \`goalCondition\` (verification_signal is prose — author a machine check before driving).`,
    `- **${goalItems.length}** goal/research items (P41–P44 style — draft as \`feature-absent\` drives, not audit findings).`,
    `- Findings coverage: **${coveredIds.size}/${findings.length}** covered by a plan item; **${uncovered.length}** uncovered (listed in drive-order.json).`,
    cyclic.length ? `- ⚠️ dependency cycle among: ${cyclic.join(", ")} (appended in plan order).` : ``, ``,
    `## Drive in this order (topological on depends_on, then plan order)`, ``,
    `Each row = one \`--drive --spec\` invocation. ✅ = machine-checkable oracle ready.`, ``,
    `| seq | plan | finding | sev | oracle | bug site | depends_on | title |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...units.map(row), ``,
    `## Run one`, ``,
    "```bash",
    `node orchestration/src/fix_pipeline.mjs --drive --spec ${outDir}/spec_${units[0].spec._meta.plan_id}_${units[0].spec.id}.json --cwd <worktree>`,
    "```", ``,
    `Pre-flight first: \`fix_pipeline.mjs --selftest\` then \`--dry-run\`. For a batch, feed \`queue.jsonl\` to \`drive_supervisor.sh\` per row, honoring the depends_on order above.`, ``,
  ].filter((l) => l !== null).join("\n");
  writeFileSync(join(outDir, "SPECGEN_REPORT.md"), report + "\n");

  console.error(`[specgen] wrote ${units.length} specs + queue.jsonl + drive-order.json + SPECGEN_REPORT.md -> ${outDir}`);
  console.error(`[specgen] ${drivable.length} drivable now · ${needOracle.length} need oracle · ${goalItems.length} goal-items · ${uncovered.length}/${findings.length} findings uncovered`);
}

main();
