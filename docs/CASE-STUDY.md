# Case study — what a driven PR actually looks like (and how to check it yourself)

Everything in this document comes from real drives: the training-data corpus, the merged PRs, and
the operator's H2 records, examined end-to-end in July 2026. It exists because the project's best
evidence for itself is its own output — and a prospective user should be able to see that output,
know what running a drive actually costs, and know how to independently re-verify a finished one.

## 1. The headline: a free model fixed a real bug, and every layer earned its keep

**PrimordialEncounters PR #14** — finding F017: a unit-conversion constant
(`KM_S_TO_AU_DAY`) wrong by a factor of ~86, silently inflating every sampled velocity. The walk:

1. **The drive** ran on a **free model** (the packet's `classified_by` reads
   `nvidia/nemotron-3-ultra-550b-a55b`) through the standard spine. Marginal model cost: ~$0.
2. **The packet** (the PR body) carried quantitative evidence: live-fire execution showing the
   corrected median velocity (0.177 AU/day) matching the Maxwell-Boltzmann theoretical prediction
   (~0.178), a SHA-pinned one-line diff, greps proving the buggy constant appeared nowhere else,
   six sibling findings *explicitly deferred with reasons* (one — an ~820x error in another
   module — flagged as the next drive), and a Class F section openly documenting that the walk's
   tests-change deleted two tests, rather than hiding it.
3. **The bot review** (CodeRabbit) posted 4 actionable comments — including a real catch: the
   test suite's `rng` fixture never actually seeded the sampler, which read global `np.random`.
   A weak model's verification theater, caught by an independent layer.
4. **The human at H2** ran a recorded SVP session: a falsifiable prediction sealed *before* the
   diff was revealed (the console timestamps enforce this to the millisecond), a trace, and an
   adversarial probe of the packet's own claims. The probe caught what no gate could: the fix
   used a 4-significant-figure AU value, and the project hunts centimeter-scale signals.
5. **The pre-merge work that judgment triggered** is documented in the PR's *Post-Packet
   Addendum*: a new `src/constants.py` deriving every value from official sources (IAU 2012 exact
   AU via `scipy.constants`), source-pinning tests, the rng fix, and edge-case tests — each
   traceable to a recorded session finding or filed issue.
6. **The merge** was performed by the human. Agents never merge; twelve spine-complete drives in
   the corpus all terminate at `awaiting-H2`.

Three different failure modes, caught by three different layers — a gate, a bot, a human — each
seeing something the others structurally could not. That is the argument for the layering.

A second exemplar, on the Claude tiers: **bio-systems-engineering PR #13** (the external-oracle
pilot). Its terminal verdict is machine-checkable — 11/11 contract items verified, 0 unverified,
all classes A-F present and non-vacuous, pinned to an exact head SHA — and its seam evidence is
sha256-hashed artifact files sitting in the PR diff (`baseline_red.txt`: 5 FAIL at base;
`head_green.txt`: green at HEAD).

## 2. The numbers (corpus snapshot, July 2026)

| Metric | Value |
|---|---|
| Spine-complete drives | 12, across 8 target repos — every one parked at `awaiting-H2` |
| Captured agent cost per converged drive | ~$10-19 on Claude tiers; ~$0 on the free cascade |
| Wall-clock per drive | ~30-90 min (run it under `drive_supervisor.sh`, walk away) |
| H2 cognitive session (SVP predict/trace/probe) | **median ~13 min**, typically 6-16 min per PR |
| Known bottleneck stage | `design-tests` (the only stage where gate FAILs outnumber PASSes) |

The H2 number is the honest cost of the whole idea: roughly a quarter-hour of recorded human
judgment per merged AI change, plus whatever fix-work that judgment triggers.

## 3. What to expect while a drive runs

**Gate failures mid-drive are the system working, not breaking.** The best drive in the corpus
(PR #13) read: check-drift FAIL → plan revised → PASS; design-tests attempt 1 FAIL (evidence link
not SHA-pinned — a real protocol violation, caught) → attempt 2 PASS; then a green run to
terminal. Expect the loops to loop. A **HALT** (exit 3) is different: it means fail-closed stop,
read the `HALT_*.md` marker. A **REFUTED** terminal (exit 5) is a *success* — the finding was
wrong, and the audit gets a bug report instead of the repo getting a cosmetic fix.

## 4. Pre-flight checklist (each item is a real incident from the corpus retros)

- [ ] **The target repo has test CI.** One target repo had none — an intermediate 2-failed state
      was invisible on the PR checks line, where the only green check was the review bot. The
      packet recorded it anyway, but you want the net under the net.
- [ ] **Scaffold `.aiv-workflow.yml`** in the target repo. Without it, skills silently default —
      notably `branch.base: origin/main`, which mishandles `master` repos. (Intake now scaffolds
      it, but verify.)
- [ ] **The reviewer lane has `gh`, `ruff`, `mypy` on PATH.** Missing `gh` made review comments
      drop *silently* in three drives.
- [ ] **Check your review bot actually ran.** A rate-limited CodeRabbit produces
      `coderabbit_actionable: 0` — vacuously. The gate cannot distinguish "reviewed clean" from
      "never reviewed"; the human can, by looking at the PR timeline.
- [ ] **`FIX_TRAINDATA_DIR` points at a writable git clone** — a real `--drive` refuses to run
      uncaptured (fail-closed, by design).
- [ ] For feature work, **choose an external oracle first** — see
      [`DRAFTING-DRIVES.md`](DRAFTING-DRIVES.md). Green only proves what the oracle measures.

## 5. The re-verification recipe (for H2, or any auditor, at any later date)

A finished drive can be independently cross-checked against three sources that were written by
three different mechanisms. If they agree, the evidence chain is intact:

```bash
# Source 1 — the corpus label (what the pipeline recorded at terminal):
cat <traindata>/drives/<drive_id>/manifest.json     # -> terminal, pull, pr_url, provenance_sha

# Source 2 — the packet (what the PR claims): read the PR body's Identification table
#   -> head SHA, base SHA, production commits, provenance tag name

# Source 3 — the git database (what actually exists):
git fetch origin 'refs/tags/aiv/*'
git rev-parse 'aiv/<drive_id>^{commit}'             # must equal the head SHA from sources 1 and 2

# Then spot-check the evidence itself:
git show <head_sha>:.github/aiv-packets/evidence/<drive_id>/MANIFEST.md   # artifact sha256 list
sha256sum <artifact files at that SHA>              # must match the packet's hashes
# and replay any Class A command the packet quotes — they are written to be replayable.
```

All three sources agreed byte-for-byte on every drive checked. That check — not trust in any
agent, bot, or badge — is what the protocol ultimately sells.

## 6. The addendum pattern (when H2 changes things after the packet is pinned)

The packet pins SHAs at SPINE COMPLETE. If human review then improves the change (as in PR #14),
do not rewrite the packet — its pinned claims must stay honest against the head they were proven
at. Append a **Post-Packet Addendum** to the PR body: a commit-by-commit table of what landed
after the pin, what each commit resolves, and the replayed state of the packet's key commands at
the new head. The durable `aiv/<drive_id>` tag keeps the original walk reachable either way.

## 7. Honest limits

This case study is the favorable evidence; the boundaries are documented where they belong: the
oracle-quality caveat in [`DRAFTING-DRIVES.md`](DRAFTING-DRIVES.md), the known sharp edges and the
gate model in [`MAINTAINER_GUIDE.md`](MAINTAINER_GUIDE.md), and the SoD scope note (the protocol
prevents hallucinated approvals, not collusion; the human judge remains the single independent
verifier) in the aiv-protocol README. Notably, every gap surfaced by the outside examination that
produced this document was already named in the project's own drive retros — the system finds its
own holes, which is the property that matters most in a verification tool.
