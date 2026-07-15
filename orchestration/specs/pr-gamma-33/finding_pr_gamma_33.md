# FINDING PR-GAMMA-33 — Tracker RUN FULL AUDIT is not drivable from prod (LAUNCH greyed by a false-CRITICAL preflight)

| Field | Value |
|---|---|
| ID | PR-GAMMA-33 |
| Severity | high |
| Status | unverified (drive reproduces "behavior absent" at base) |
| Location | `src/lib/tracker/preflight.ts:138` (`validateEnvVars`) + `src/pages/api/tracker/preflight.ts:40` (`fetchActiveVmCount`) + `src/pages/api/tracker/preflight.ts:96` (composition) |
| Class / Category | **feature-absent** |
| Closes | #295 + the new preflight-blocker issue |
| Spec § | `docs/proposals/TRACKER_UI_REDESIGN.md` §1.1 (the single success criterion) |

## Toolchain (READ FIRST — this is a Node/TypeScript/Astro repo, NOT Python)

There is **no Python venv** in this repo. Ignore any pytest/`.venv`/`pip`/`make install` hints from the
generic stage prompts — they do not apply here. Use the Node toolchain:

- **Provision:** `npm ci` (a `package-lock.json` is committed). Never `pip`/`venv`.
- **Tests:** `npx vitest run` (or `npm test`). Specs are `*.spec.ts` (Vitest), NOT pytest.
- **Typecheck:** `npx tsc --noEmit` (and `npx astro check`). **Lint:** `npm run lint` (eslint).
- **Spec locations (contract [9] / [[feedback-astro-routing-collision]]):** put NEW specs under
  `src/lib/tracker/preflight.spec.ts` (exists — extend it) and `tests/unit/components/RunFullAuditModal.spec.ts`
  (new). **Zero** `*.spec.ts` under `src/pages/` (Astro routing collision) beyond what already exists there.
- **DB live-fire IS runnable here (Docker is up).** The watcher-nodes DAL integration test
  (`tests/db/watcher-nodes-dal.integration.spec.ts`) is gated `describe.skipIf(BB_SKIP_DB_PROVIDER)` and skips
  by default. A Docker daemon IS available in this environment, so at **prove-it** run the composed-path
  live-fire FOR REAL and record it as a real **Class A PASS** — do NOT WARN/skip it:
  `BB_SKIP_DB_PROVIDER=0 npx vitest run tests/db/watcher-nodes-dal.integration.spec.ts` (testcontainers pulls
  `postgres:15-alpine`, which is already cached). Only fall back to WARN if Docker is genuinely unreachable.

## Required behavior that is ABSENT

On production `www.blackboxresearchlabs.com/tracker`, an operator **cannot drive an audit from the UI**:
target-select → **LAUNCH is greyed** → no dispatch. The RUN FULL AUDIT modal's preflight emits a
CRITICAL "Missing required environment variables" blocker; the modal disables LAUNCH on any CRITICAL
(`src/components/RunFullAuditModal.astro:277-278`). This is the exact §1.1 gap the whole tracker
redesign exists to close: *"operator selects a target, clicks RUN FULL AUDIT once, watches every chain
step stream in real-time, and sees findings render — all from the UI, with zero shell fallback."*

## The oracle (approach-agnostic — grades the OUTCOME, not a locked approach)

`goal_condition` (machine-checkable, external to the fix, runnable in the worktree):

```
cd <cwd> && npx tsc --noEmit \
  && npx vitest run src/lib/tracker/preflight.spec.ts tests/unit/components/RunFullAuditModal.spec.ts
```

exits 0 when — and only when — the preflight/modal specs assert ALL of:

1. **No false-CRITICAL for forensic-node tokens absent from the Vercel process env.** The dispatch-side
   preflight must NOT emit a dispatch-blocking CRITICAL merely because `BLOB_READ_WRITE_TOKEN` /
   `HCLOUD_TOKEN` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` are absent from the *Vercel function's*
   `process.env`. (These are execution-side secrets — see the Consumer trace below.)
2. **The capability signal is sourced from the environment that actually executes the audit** (the
   forensic node — via `/api/watch/health` / a watcher capability report), not from the Vercel
   function's `process.env`.
3. **No green-on-absence for quota.** `fetchActiveVmCount` (`src/pages/api/tracker/preflight.ts:40-42`)
   must NOT return `0` (which reads as "under quota → OK") when `HCLOUD_TOKEN` is absent; a missing
   token / hcloud error must surface as a real blocker or "capability unknown", never "Hetzner quota
   OK". Token-absent ⇒ not-green.
4. LAUNCH-enable logic: with a live/capable forensic node and no *genuine* CRITICAL, LAUNCH enables.

The SEAM (RED-at-base → GREEN-at-HEAD) holds: at `origin/main`, `validateEnvVars(process.env)` on a
Vercel-shaped env (forensic-node tokens absent) returns a dispatch-CRITICAL (RED = the false-CRITICAL
present, LAUNCH greyed); at HEAD the re-targeted check returns no dispatch-CRITICAL when the forensic
node is capable (GREEN = behavior present).

> **Bounded-correctness note.** This local oracle bounds correctness to *unit-level* preflight/modal
> behavior. The **§1.1 production bar** — LAUNCH enables on real prod → dispatch → chain-progress lights
> per gate → SSE live-feed streams ≥5 events over ~10 min with no "Reconnecting attempt N" → findings
> render, with ≥3 operator screenshots + visual sign-off — is **irreducible H2 human verification** and
> is NOT part of `goal_condition`. The drive closes the code-level blockers and opens the PR; the
> operator performs the prod live-fire + visual sign-off + merge (VERIFY [6]/[7]/[10] of the contract).

## Do-NOT-touch scope (the answer key)

- Do NOT weaken or delete the preflight/modal specs to make the oracle pass; extend them to assert the
  invariants above. A spec diff that removes an assertion is a stop-condition.
- Do NOT stub `/api/watch/health` or the DAL to fake watcher capability.
- Do NOT re-introduce a `return 0`-on-absent-token path in `fetchActiveVmCount`.

## Investigation (pre-locked — satisfies contract VERIFY [1] + [2])

Root cause of "env bound in Vercel but reported missing at runtime" was UNKNOWN. Ranked hypotheses +
decisive evidence:

- **(b) The check targets the WRONG environment — CONFIRMED (recommended Path B).** The five tokens are
  consumed at **forensic-node execution**, not Vercel dispatch. The `run-full-audit` route
  (`src/pages/api/tracker/run-full-audit.ts:157-182`) only calls `dal().enqueueJob()` ×3 — it consumes
  none of the tokens. Consumer trace:
  - `BLOB_READ_WRITE_TOKEN` — `src/lib/blob/upload-pdf.ts:8` documents it *"operator-bound; **never on
    Vercel**"*; baked into VM cloud-init (`upload-dump.ts:8`).
  - `GITHUB_TOKEN` — `src/lib/forensic/cloud-init.ts:57-58,142-143`: **baked into the VM via
    cloud-init**; *"dispatch-driven VM has no shell context"*. (Note: `GITHUB_TOKEN` is no longer even
    in `REQUIRED_ENV_VARS` — the brief is ~4 weeks stale; see Divergence below.)
  - `GEMINI_API_KEY` — `src/lib/agent/gemini-cli.ts:520`: provided *"from the watcher, NOT via
    env-injected GEMINI_API_KEY"*.
  - `HCLOUD_TOKEN` — forensic ops (`src/lib/forensic/cli-impl.ts:87`), operator-runtime `.env.local`
    (`src/lib/hetzner/client.ts:40`). The Vercel function touches it ONLY in `fetchActiveVmCount` for a
    quota *display* — which is the false-green bug, not a dispatch need.
  - Corroborating false-green: `fetchActiveVmCount` returns `0` on absent token → "quota OK" — which
    CONFIRMS the token is genuinely absent at Vercel runtime.
- **(a) Vercel injection glitch / (c) SSR-adapter sandbox — LESS likely, and NOT machine-drivable.**
  Even if true, injecting the tokens into Vercel is treating a symptom: the Vercel function never uses
  them for dispatch, so a green env-row would be verification theater. Path A's only oracle is live
  prod Vercel state — the headless pipeline cannot grade it. **Path B is both architecturally correct
  and the path the fix pipeline can actually drive.**

## Divergence from the 2026-06-18 brief (verified against `origin/main` on 2026-07-14)

- `REQUIRED_ENV_VARS` is now `[BLOB_READ_WRITE_TOKEN, HCLOUD_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY]`
  (`src/lib/tracker/preflight.ts:51-56`) — `GITHUB_TOKEN` was removed; `ANTHROPIC_API_KEY` +
  `GEMINI_API_KEY` were added. The finding/oracle target the CURRENT set.
- The modal env-row label (`RunFullAuditModal.astro:196`) still reads
  "HCLOUD_TOKEN, BLOB_READ_WRITE_TOKEN, GITHUB_TOKEN" — stale; the fix should reconcile it.
- `src/lib/tracker/preflight.spec.ts` already exists and tracks the current `REQUIRED_ENV_VARS`
  (PF-T6/T7) — the drive EXTENDS it, it does not author it from scratch.

## In-scope blockers (all with code anchors)

1. Preflight env false-CRITICAL (Path B re-target) — `src/lib/tracker/preflight.ts` + route `:96`.
2. False-green VM quota — `src/pages/api/tracker/preflight.ts:40-42`.
3. Snapshot-stale CRITICAL + REBUILD SNAPSHOT — `computeSnapshotAge` (`preflight.ts:65`) freshness
   threshold decision (keep vs relax) + verify `POST /api/tracker/preflight/rebuild-snapshot` clears it.
4. SSE live-feed prod verification (closes #295) — `resolveListenerConnectionString`
   (`src/lib/dal/database.ts`) already guards the non-pooler `DATABASE_URL_DIRECT`; VERIFY under live
   audit load is **H2**.

## Out-of-scope (pin as issues; do not fold in)

Audit-quality substrate (γ.29/30/31); self-hosted runner stability; multi-target dispatch; STT token
rotation. Any Vercel-platform/adapter change beyond code → surface via the operator, do not attempt in
the drive.
