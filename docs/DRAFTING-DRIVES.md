# Drafting non-bug-fix drives

The fix pipeline is finding-driven and grew up on bug fixes, but it drives **features, consistency/doc
work, refactors, and more** — *if* you express them as findings and get the oracle right. This is the
runbook. It is grounded in a CS336 feature-drive stress test (which produced the `feature-absent`
PR-class and the `gateProveIt` N/A fix), not speculation.

## The one idea: a non-bug finding is "required behavior is ABSENT"

A bug fix says *"defect X at line N; here's the repro."* A feature says *"required behavior X is absent;
here's the oracle that is currently RED."* Same shape — a **falsifiable anchor plus a machine-checkable
oracle** — so the same 14-stage spine applies: `verify-finding` reproduces "behavior absent" instead of
"bug present", `design-tests` **adopts** the external oracle instead of authoring one, and the SEAM proves
absent→present instead of buggy→fixed.

## Step 1 — Choose the oracle (this is the whole game)

The `goalCondition` is the load-bearing decision. It must be **machine-checkable** *and* **external** — an
answer key the driving agent cannot author or weaken. If the agent writes both the solution and the test
that grades it, "green" means nothing (verification theater).

Oracle-strength triage — strongest first:

| Strength | Source | Example |
|---|---|---|
| STRONG | Shipped conformance suite | JSONTestSuite, NIST KATs, a course's own tests |
| STRONG | Published reference / formula | a physical constant, a spec equation |
| STRONG | Invariant | round-trip `decode(encode(x))==x`, conservation, monotonicity, dimensional |
| STRONG | Differential vs an independent implementation | your parser vs the stdlib; your softmax vs `F.softmax` |
| STRONG | Pre-existing real failing test | a red test that already exists in the repo |
| **WEAK — rewrite before dispatch** | Self-authored | *"add a test and make it pass"* — the agent defines *and* satisfies its own success |

**Rule:** if any external truth exists but your goal is weak, rewrite the goal to encode the external
property *before* you dispatch.

**The bounded-correctness caveat** (learned the hard way): *the output is bounded by what the oracle
measures.* A softmax that passes a float32 test can still be wrong for bf16 — because the test never checks
bf16. If you need a property, the oracle must test it. Green proves only what it measures; decide up front
what it must measure, and keep a human at H2 for the rest.

## Step 2 — Make it drivable: stub-at-baseline

`verify-finding` and the SEAM both need a real thing to revert and a real RED at the base commit. So the
feature's **entry point must exist as a stub at baseline** — `raise NotImplementedError`, return a
sentinel, whatever *fails the oracle*.

- **Best case:** the codebase ships an interface/adapter layer of stubs (CS336's `tests/adapters.py` is 27
  of them). Use it as-is.
- **Truly greenfield:** scaffold a stub of the public entry so the SEAM has a bug-site to revert. Without
  it, the SEAM RED degrades to an `ImportError` ("symbol absent at base") — it still holds, but it is
  noisier and less precise.
- **Favor a single entry point** so the SEAM's single-file revert cleanly isolates the change; a diffuse
  multi-file feature strains it.
- **One finding per component.** Don't drive a whole multi-part feature as one finding — it blows the
  convergence caps. Decompose (softmax → rope → attention → the LM), one drive each.

## Step 3 — Write the finding (`audit/02-static-audit.md`)

The immutable Class-E intent every packet points back to. One table row:

```
| ID | Severity | Location | Category | Description |
|----|----------|----------|----------|-------------|
| MY-FEATURE | high | path/to/stub.py:entry_fn | feature-absent | `entry_fn` raises NotImplementedError; `<oracle test id>` fails. Implement <behavior> so the oracle passes. Do NOT modify the oracle test or its fixtures. |
```

Category is **`feature-absent`**. Name the stub as the Location, the oracle in the Description, and the
do-not-touch scope (the answer key) explicitly.

## Step 4 — Write the spec

The per-finding spec is the only per-drive input. For a non-bug drive, the fields carrying the extra weight:

| Field | For a feature |
|---|---|
| `goalCondition` | the external oracle command (Step 1), e.g. `uv run pytest -k test_x` → exit 0 |
| `bugSite` | the **stub / entry point the SEAM reverts** |
| `intentSource` / `intentLine` | the `audit/02-static-audit.md` finding row |
| `changeIdPrefix` | the `drive_id` (lowercase, kebab) |
| `id`, `repo`, `baseBranch`, `cwd` | as for any drive |

Full field reference: `orchestration/src/fix_pipeline.mjs` (`loadSpec`/`applySpec`), or run
`node orchestration/src/fix_pipeline.mjs --drive --plan --spec <f.json>` to echo the parsed spec with no
side effects.

## Step 5 — Bind the target (`.aiv-workflow.yml`)

Point the skills at the real runner so they don't silently default (a missing config was a recurring
corpus failure):
```yaml
branch: { base: <base-ref>, install_cmd: "<env setup, e.g. uv sync>" }
ci:     { local_replica_cmd: "<test cmd>", test_cmd: "<test cmd>" }
```

## Step 6 — Classify it: `feature-absent`

`launch-brief` recognizes `feature-absent` natively. Its completion-contract bundle asserts:
- **BEHAVIOR PRESENT** — the `goalCondition` oracle exits 0 (approach-agnostic; grades the *outcome*, not a
  locked approach).
- **ORACLE UNMODIFIED** — the external test + fixtures are byte-identical base→HEAD (a diff is a
  stop-condition: the agent must not weaken the answer key).
- **REAL IMPLEMENTATION, NOT DELEGATION** — advisory grep against forwarding to a builtin the oracle can't
  distinguish (anti-theater signal for H2, not a hard gate).

## Step 7 — Drive it

Same machinery as a bug fix:
- **Full spine:** `--intake …` → `orchestration/src/drive_supervisor.sh <spec> <log>` (parks at H2).
- **Local front-half (no PR):** hand-author the spec + finding brief, then
  `--run-stage launch-brief|plan|check-drift|verify-finding|design-tests|write-code|prove-it` in order. Run
  the pytest-looping stages (`write-code`, `prove-it`) in the **background** — they exceed a short
  foreground timeout.
- **SEAM only:** `--seam-check --spec <f.json> --cwd <wt>` validates RED→GREEN deterministically (no model).

## Gotchas (hard-won)

- **Weak oracle = theater.** The #1 failure. Fix the oracle, not the drive.
- **Green ≠ correct.** The oracle bounds correctness (the bf16 lesson). Make it demand what matters.
- **Never let the oracle be modified.** The ORACLE-UNMODIFIED slot exists because an agent can "pass" by
  weakening the answer key.
- **Repo-embedded agent instructions can derail a drive.** Every stage is a Claude Code subagent, so a
  checked-in `CLAUDE.md`/`AGENTS.md` (or even a git-history trail) can make it refuse or misbehave — it
  treats such files as authoritative. Strip/neutralize untrusted repo instructions that aren't the
  operator's before driving.
- **`design-tests` adopts, it doesn't duplicate.** When the oracle already exists, it correctly writes no
  redundant test and instead catalogs the oracle's *coverage gaps*. Don't force it to re-author the oracle.

## Worked example

CS336 `run_softmax` as `feature-absent`: finding = *"`run_softmax` raises NotImplementedError;
`test_softmax_matches_pytorch` fails"*; oracle = differential vs `torch.nn.functional.softmax` (external);
bug-site = the adapter stub; base = a stub-at-baseline clone. Result: green oracle + dual-verified evidence
(0 unverified, 9 sha256'd artifacts, adversarial probe + independent assessor both CONFIRMED) in a single
drive. The one gate it tripped — `prove-it` rejecting a legitimate `N/A` claim — became a pipeline fix, and
the class it had to invent became this document.
