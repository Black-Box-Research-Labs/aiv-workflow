# Weak / free-model coding techniques — deep-research report

> Generated 2026-06-25 by the `deep-research` workflow harness (fan-out web search → fetch → adversarial 3-vote verify → synthesize).
> Run: 109 agents, 26 sources fetched, 126 claims extracted, 25 verified (23 confirmed, 2 killed), 10 findings after synthesis.
> Purpose: techniques to lift WEAK/free open coding models in our agentic fix-pipeline (execution-based fail-closed gates).

## Research question

```
Techniques and strategies for maximizing the code-output quality of WEAK / small / cheap open-source coding models (free-tier models roughly 30B-120B, e.g. gpt-oss-120b, Qwen3-Coder, Poolside Laguna) in an AUTONOMOUS AGENTIC software-engineering pipeline that has EXECUTION-BASED FAIL-CLOSED GATES (the harness runs the model's tests/code/lint and only advances on green; a weak model can only HALT, never false-pass). Focus on INFERENCE-TIME techniques (no fine-tuning), cheap to run, that specifically help weaker models close the gap to stronger ones. Cover, with concrete empirical numbers (pass@1 / SWE-bench lift) and primary sources where possible:
(1) Prompting strategies — plan-then-code, task decomposition, localization-then-edit (Agentless-style fault localization before editing), structured/role prompting, and constraint prompting to PREVENT scope creep / unwanted refactors / renaming public symbols (a real failure we hit: a weak model renamed a class and broke imports);
(2) Test-time compute scaling — best-of-N / repeated sampling, self-consistency / majority voting, temperature tuning, and how to SELECT the best sample using tests/execution as the oracle (since we already have a fail-closed test gate);
(3) Iterative self-repair / execution-feedback loops — feeding compiler/test/lint tracebacks back to the model to fix, how many repair rounds actually pay off, diminishing returns, and failure modes (model thrashing);
(4) Output-format constraints — search/replace or unified-diff editing vs whole-file rewrite, constrained decoding / grammars, to reduce broken or non-surgical edits;
(5) Model cascades / ensembles, verifier or reranker models, and LLM-as-judge selection;
(6) Context engineering — retrieving only the relevant code, minimizing irrelevant context, repo-map / RAG-over-codebase techniques.
Prioritize techniques with the strongest evidence of lifting WEAK models specifically, rank them by cost/benefit for a $0 free-model pipeline, and note which integrate cleanly into an agentic loop that already has an execution-based gate and a model cascade.
```

## Executive summary

For a $0 free-model agentic pipeline with an execution-based fail-closed gate, the strongest evidence-backed lever for closing the weak-to-strong gap is repeated sampling plus execution-based selection: because your test gate is a reliable verifier, generating many candidate samples and keeping the one(s) that pass tests converts coverage gains directly into solved-task gains — DeepSeek-Coder-V2 rose from 15.9% to 56% on SWE-bench Lite at 250 samples, beating the 43% single-shot SOTA (Large Language Monkeys). The second pillar is the Agentless-style fixed pipeline — hierarchical localization-then-edit, search/replace diff editing (not whole-file rewrite), and execution-filtered + AST-normalized majority voting — which hit 32% on SWE-bench Lite at $0.70/issue, and whose ablations show that minimizing context and selecting via test/reproduction oracles drive most of the gain. Iterative self-repair helps but only when the test oracle is trustworthy: with reliable/oracle tests it yields significant gains concentrated in the first ~2 rounds (diminishing after), but with self-generated tests it actively HARMS weak models (Llama-3-70B, Qwen2.5-Coder-7B declined across all basic benchmarks) because false-negative test labels make the model thrash on already-correct code — your execution gate must be the oracle, never model-generated tests used naively. Finally, decomposing the pipeline into component-specialized small models beats one monolithic small model (Co-PatcheR: 3×14B reached 46% on SWE-bench-Verified, beating a 70B single model at 41%), which validates a cascade/role-specialized architecture. Ranking by cost/benefit for free models: (1) localization-then-edit + search/replace diffs + context minimization (Agentless), (2) repeated sampling with execution-based selection, (3) bounded self-repair (cap ~2 rounds, gate on REAL tests only), (4) component decomposition/cascade.

## Findings (adversarially verified)

### 1. Repeated sampling is a reliable inference-time scaling axis: coverage (fraction of problems solved by at least one sample) scales log-linearly with sample count over four orders of magnitude, and when an automatic verifier exists (coding/proofs) those coverage gains translate directly into solved-task performance. This makes a weak+many-samples configuration beat a stronger single-shot model — DeepSeek-Coder-V2-Instruct rose from 15.9% (1 sample) to 56% (250 samples) on SWE-bench Lite, beating the 43% single-sample SOTA. Your fail-closed test gate IS the verifier that makes this work.

- **Confidence:** high · **Vote:** 3-0 (each of the three constituent claims)
- **Sources:** <https://arxiv.org/abs/2407.21787>
- **Evidence:** Three claims (0,1,2) all from the primary 'Large Language Monkeys' paper (Stanford Scaling Intelligence Lab + Google DeepMind, 2024), all 3-0 votes. Abstract verbatim: coverage 'scales with the number of samples over four orders of magnitude... log-linear... exponentiated power law'; SWE-bench Lite DeepSeek-Coder-V2 15.9%->56% at 250 samples beating 43% SOTA; 'In domains like coding and formal proofs, where answers can be automatically verified, these increases in coverage directly translate into improved performance.' The paper explicitly contrasts: in domains WITHOUT verifiers, majority voting/reward models plateau ~100 samples — so execution gating is the mechanism.

### 2. An Agentless-style fixed (non-agentic) pipeline of hierarchical localization -> repair -> patch validation is the most cost-effective architecture for weak models: it hit 32.00% (96 fixes) on SWE-bench Lite at only $0.70/issue, beating all contemporaneous open-source agents on both performance and cost, demonstrating a simple fixed pipeline can beat complex autonomous agents.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://arxiv.org/abs/2407.01489>, <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- **Evidence:** Claims 11 and 15 (3-0 each), corroborated across the arXiv preprint and the FSE 2025 peer-reviewed PDF. Verbatim: 'simplistic Agentless is able to achieve both the highest performance (32.00%, 96 correct fixes) and low cost ($0.70) compared with all existing open-source software agents at the time of paper submission.' No autonomous LLM tool-use/planning. Contemporaneous open-source competitors confirmed below 32% (Moatless ~23.33%, AutoCodeRover ~19.00%).

### 3. Localization-before-edit should be hierarchical (file -> class/function/variable -> edit location) and run before any editing. Combining prompting-based retrieval (78.7% file-level accuracy alone) with embedding-based retrieval (67.7% alone) reaches 81.3% ground-truth file localization. This directly answers the request for Agentless-style fault localization before editing.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://arxiv.org/abs/2407.01489>, <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- **Evidence:** Claims 12 and 16 (3-0 each), verified against the FSE 2025 PDF (Table 2). Three-step hierarchical localization confirmed verbatim. File-level accuracy: prompting 78.67%, embedding 67.67%, combined 81.33% on SWE-bench Lite with GPT-4o. Methods complement each other.

### 4. Use search/replace (diff) editing rather than whole-file rewrite to produce small, surgical, cost-efficient edits and reduce hallucination — improving patch reliability/accuracy. This is the recommended output-format constraint and is also the lowest-risk way to prevent scope creep / unwanted refactors (whole-file rewrite is exactly what lets a weak model rename a public class and break imports).

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://arxiv.org/abs/2407.01489>
- **Evidence:** Claim 13 (3-0). Verbatim from Agentless: 'generates patches using a simple diff format [Gauthier 2024] to avoid generating the complete code and instead focus on producing cost-efficient small edits, increasing the reliability and accuracy of patch generation (less chances for hallucination).' Implementation uses Aider-style Search/Replace blocks. Note: the constraint-prompting-against-renaming-public-symbols failure mode in the question is best mitigated structurally (small diffs over a fixed localized region) rather than relying on prompt instructions alone — the surveyed evidence supports the structural mechanism, not specific anti-rename prompt wording.

### 5. Minimizing/engineering context improves BOTH accuracy and cost: feeding a concise skeleton (class/function headers) instead of full file content both lowers cost and INCREASES correct localizations, because LLMs handle long context poorly and get confused by entire-file contents. Retrieve only the relevant code; do not dump whole files.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- **Evidence:** Claim 17 (3-0), verified against downloaded FSE 2025 PDF Section 5.2.1. Verbatim: 'by using the complete file content, not only is the cost much higher but also the number of localized groundtruth issues is reduced... LLMs cannot handle long context very well, so providing the entire file contents can confuse the model.' Skeleton format cut context from >3000 LoC to <800. Especially salient for weak/small models with limited effective context.

### 6. Select the best of N patches via execution-based filtering plus AST-normalized majority voting: sample greedy-first then higher-temperature, filter out syntax/regression-test failures, then re-rank by highest occurrence after AST canonicalization. Execution-based selection drives most of the gain over voting alone — voting alone resolved 77, +regression-test filtering -> 81, +generated reproduction-test filtering -> 96 (32%). The reproduction-test (execution) oracle was the single largest contributor.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://arxiv.org/abs/2407.01489>, <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- **Evidence:** Claims 14 and 19 (3-0 each). Table 4 from FSE 2025 PDF: Majority voting 77 (25.67%) -> +Regression test 81 (27.00%) -> +Reproduction test 96 (32.00%). Sampling is greedy-then-higher-temperature; AST normalization (Python ast, docstrings removed, canonical unparse) then re-rank by occurrence. This maps cleanly onto a pipeline that already has an execution gate — the gate doubles as the selector.

### 7. Repeated patch sampling shows diminishing returns within the Agentless pipeline: 1 greedy sample already fixes 80 issues, performance plateaus around 40 samples (because majority-voting-after-test-filtering ignores later samples), final execution/voting selection recovers 96 of an oracle upper bound of 126 solvable issues. So a few-to-~40 samples captures nearly all attainable gain in this setup; the large per-sample budgets (250) in Finding 1 apply to pure pass@k coverage, not to this specific vote-based selector.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- **Evidence:** Claim 18 (3-0), verified against FSE 2025 PDF. '1 greedy sample... 80'; 'performance plateaus at around 40 samples'; oracle upper bound '126 (42.0%)' vs selected 96 (32.00%). The plateau is a property of the majority-voting selector, not of coverage itself — better re-ranking/selection is named as the headroom. Reconcile with Finding 1: coverage keeps rising with samples, but a voting selector caps realized gain, so invest sampling budget where the selector can exploit it (execution filtering > pure voting).

### 8. Iterative self-repair (feeding execution errors back) reliably improves pass rates when the test oracle is trustworthy, with most gains in the FIRST TWO repair rounds and strong diminishing returns after — across seven models (8B to large), +4.9 to +17.1pp on HumanEval and +16.0 to +30.0pp on MBPP, with two rounds capturing 76-95% of achievable gains. Practical guidance: cap repair at ~2 rounds. Self-Debugging mechanics (rubber-duck, reuse failed predictions) can match baselines that sample >10x more candidates, and on TransCoder/MBPP improve accuracy up to 12%.

- **Confidence:** high · **Vote:** 3-0 (Self-Debugging claims); 2-1 (the seven-model diminishing-returns claim)
- **Sources:** <https://arxiv.org/html/2604.10508>, <https://arxiv.org/pdf/2304.05128>
- **Evidence:** Claims 5 (2-1, but specifics verified high), 6/7/8 (3-0 each, Self-Debugging ICLR 2024). The seven-model study (arXiv 2604.10508, Apr 2026, v1 preprint): universal improvement, gains concentrate first two rounds, 'Two repair rounds capture the majority (76-95%) of achievable gains.' Self-Debugging (Chen et al., ICLR 2024): rubber-duck debugging without human feedback, up to 12% on TransCoder/MBPP, matches/beats baselines generating 10x candidates. Caveat: 2604.10508 is on HumanEval/MBPP (easier than SWE-bench) and a v1 preprint; Self-Debugging used strong 2023-era models, not weak 30B-120B open models.

### 9. CRITICAL FAILURE MODE — self-repair gated on SELF-GENERATED tests harms weak models. Post-execution self-debugging with self-generated tests DEGRADED pass@1 on HumanEval/MBPP, worst for weaker models (Llama-3-70B-instruct and Qwen2.5-Coder-7B-instruct declined across ALL benchmarks; stronger models only on HumanEval). The harm is from test-label bias (false-negative labels: correct code wrongly flagged) — the model wastes rounds 'fixing' already-correct code. With ORACLE tests the same loop yields significant gains. Lesson: gate repair ONLY on real/execution-based tests, never on naively model-generated tests.

- **Confidence:** high · **Vote:** 3-0
- **Sources:** <https://arxiv.org/html/2501.12793>
- **Evidence:** Claims 9 and 10 (3-0 each), ACL 2025 long paper, verified verbatim. 'declines across all benchmarks for Llama-3-70b-instruct and Qwen2.5-coder-7b-instruct'; 'testing on self-generated tests is more likely to result in false negative labels than true negative ones on both HumanEval and MBPP'; 'self-debugging with oracle tests, showcasing significant improvements as iterations progress.' Directly relevant: your fail-closed gate using a TRUSTED test suite is the safe configuration; introducing model-generated tests into the gate could invert the benefit for weak models.

### 10. Decompose the agentic patching pipeline into component-specialized small models rather than one monolithic small model — this lets small models exceed a larger single model. Co-PatcheR (3×14B specialized models) reached 46% on SWE-bench-Verified, beating a 70B single-model SOTA at 41%. Motivation: localization, generation, and validation have distinct workflows/required expertise, so a single small model struggles end-to-end. Effective structure is localization-then-edit (two-step localization pinpointing suspicious lines) with generation combined with a self-critique step.

- **Confidence:** high · **Vote:** 3-0 (decomposition + headline numbers); 2-1 (the method-description sub-claim)
- **Sources:** <https://arxiv.org/abs/2505.18955>, <https://arxiv.org/abs/2502.18449>
- **Evidence:** Claims 20, 21, 22 (20/21 are 3-0; 22 is 2-1). Co-PatcheR (NeurIPS 2025): '46% resolved rate on SWE-bench-Verified with only 3x14B models... smallest models.' Baseline 70B/41% = SWE-RL/Llama3-SWE-RL-70B (arXiv 2502.18449, Meta-confirmed). Validates a cascade/role-specialized architecture that integrates cleanly with your existing model cascade. IMPORTANT CAVEAT: Co-PatcheR FINE-TUNES its small models — it is NOT a pure inference-time technique. The transferable, inference-time-only takeaway is the architectural pattern (component-specific roles + localization-then-edit + generate-with-critique), not the trained weights. Also note the comparison is 3-model/60-candidate vs single 70B/500-candidate, not strictly apples-to-apples.

## Caveats

Time-sensitivity / staleness: The '43% single-shot SOTA' (Large Language Monkeys) and '32% / $0.70' (Agentless v1) figures are mid-2024 snapshots; absolute SOTA has moved (Agentless repo itself now reports 40%+ with Claude 3.5 Sonnet). The MECHANISMS (repeated sampling + execution selection; localization-then-edit; search/replace diffs; bounded self-repair) remain valid; treat the specific percentages as illustrative, not current ceilings. Source quality is strong overall: most load-bearing claims trace to peer-reviewed primary sources (ICLR 2024, ACL 2025, FSE 2025, NeurIPS 2025) with verbatim quote verification. Two weaker spots: (1) the seven-model self-repair diminishing-returns paper (arXiv 2604.10508) is a v1 preprint, not peer-reviewed, and tested on HumanEval/MBPP which are far easier than SWE-bench-style repo edits — the 'first two rounds' guidance may not transfer cleanly to multi-file agentic editing. (2) Co-PatcheR (2505.18955) FINE-TUNES its models, so it sits outside the strict $0/no-fine-tuning, inference-time-only frame — only its architectural pattern transfers, not its results. WEAK-MODEL SPECIFICITY GAP: Much of the strongest empirical evidence (AlphaCodium 19->44%, Self-Debugging up-to-12%, Agentless ablations) was generated on STRONG models (GPT-4/GPT-4o), not the 30B-120B free-tier models in scope. The clearest weak-model-specific evidence is: repeated sampling lifting weak DeepSeek-Coder-V2 past strong single-shot (Finding 1); AlphaCodium also lifting weaker GPT-3.5/DeepSeek (~17->25% / ~5->20%); and the INVERSE finding that self-generated-test self-repair harms weak models WORST (Finding on failure mode). SCOPE-CREEP / RENAME PREVENTION: the surveyed literature supports a STRUCTURAL fix (small search/replace diffs over a narrowly localized region) for preventing unwanted refactors/renames, but contains no direct controlled evidence on constraint-prompting wording (e.g., 'do not rename public symbols') — that specific mitigation is inferred, not empirically validated here. REFUTED for transparency: the claim that modern 8B instruction-tuned models reliably self-repair via prompting alone (contradicting prior fine-tuning-needed claims) was REFUTED (1-2); and in-execution-state self-debugging giving reliable small gains for weak models was REFUTED (1-2) — do not rely on either.

## Refuted (do NOT rely on these)

- (1-2) Weak/small models DO benefit from prompting-only self-repair without fine-tuning — modern instruction-tuned models succeed at self-repair even at 8B scale (Llama 3.1 8B), contradicting prior work that claimed weaker models fail at self-repair or require fine-tuning.  — _source: <https://arxiv.org/html/2604.10508>_
- (1-2) In-execution self-debugging — feeding the model intermediate runtime states (variable values across basic blocks of the control-flow graph) instead of pass/fail test labels — reliably gives small positive gains for both weak and strong models on basic and competitive tasks, e.g. GPT-4o +1.6 overall and Qwen2.5-Coder-7B +1.4 on MBPP-Plus by iteration 2, by sidestepping the false-label bias of self-generated tests.  — _source: <https://arxiv.org/html/2501.12793>_

## Open questions

- Do the 'first ~2 repair rounds capture 76-95% of gains' diminishing-returns findings (measured on HumanEval/MBPP single-function tasks) hold for multi-file SWE-bench-style repo edits, where localization error and cross-file effects may change the optimal repair budget?
- What is the optimal sample-budget allocation for a free-model pipeline given that pure coverage keeps rising with N (Finding 1) but a majority-voting selector plateaus ~40 samples (Finding 7)? Specifically, how much does replacing AST-normalized voting with a stronger execution-based or learned reranker raise the realized fraction of the oracle upper bound (96 of 126 in Agentless)?
- Can constraint/role prompting (e.g., explicit 'do not rename public symbols / do not refactor outside the edit region') measurably reduce scope-creep failures in weak models, OVER AND ABOVE the structural protection of small localized search/replace diffs — and is there controlled evidence quantifying this?
- Does the Co-PatcheR component-decomposition advantage (small specialized models beating a larger monolith) survive WITHOUT fine-tuning — i.e., using only role-specialized prompting/cascade routing over off-the-shelf free models — and how does it interact with an execution-based fail-closed gate?

## Sources

- [primary] <https://arxiv.org/abs/2407.21787> — _academic/primary — test-time compute & sample selection_ (4 claims)
- [primary] <https://arxiv.org/abs/2401.08500> — _academic/primary — test-time compute & sample selection_ (4 claims)
- [primary] <https://arxiv.org/html/2604.10508> — _academic/primary — test-time compute & sample selection_ (5 claims)
- [primary] <https://arxiv.org/pdf/2304.05128> — _academic/primary — test-time compute & sample selection_ (5 claims)
- [primary] <https://arxiv.org/html/2501.12793> — _academic/primary — test-time compute & sample selection_ (5 claims)
- [primary] <https://arxiv.org/abs/2407.01489> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://lingming.cs.illinois.edu/publications/fse2025.pdf> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://arxiv.org/abs/2505.18955> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://arxiv.org/html/2506.17208v1> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://arxiv.org/html/2509.23045v2> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://github.com/OpenAutoCoder/Agentless> — _localization-then-edit & agentic prompting structure_ (5 claims)
- [primary] <https://arxiv.org/abs/2306.09896> — _iterative self-repair / execution-feedback loops & diminishing returns_ (5 claims)
- [primary] <https://www.nature.com/articles/s41598-025-27846-5.pdf> — _iterative self-repair / execution-feedback loops & diminishing returns_ (5 claims)
- [blog] <https://aider.chat/docs/unified-diffs.html> — _edit-format constraints & constrained decoding_ (5 claims)
- [primary] <https://aider.chat/docs/leaderboards/edit.html> — _edit-format constraints & constrained decoding_ (5 claims)
- [primary] <https://aider.chat/docs/more/edit-formats.html> — _edit-format constraints & constrained decoding_ (5 claims)
- [blog] <https://www.inputsystems.ai/blog/2026-06-14/aider-vs-pi-harness> — _edit-format constraints & constrained decoding_ (5 claims)
- [primary] <https://arxiv.org/abs/2506.18203> — _model cascades, verifiers/rerankers & LLM-as-judge_ (5 claims)
- [primary] <https://arxiv.org/pdf/2404.00725> — _model cascades, verifiers/rerankers & LLM-as-judge_ (4 claims)
- [primary] <https://arxiv.org/html/2603.04445v2> — _model cascades, verifiers/rerankers & LLM-as-judge_ (5 claims)
- [primary] <https://arxiv.org/pdf/2504.15253> — _model cascades, verifiers/rerankers & LLM-as-judge_ (4 claims)
- [primary] <https://arxiv.org/pdf/2407.01489> — _context engineering — repo-map / RAG over codebase_ (5 claims)
- [primary] <https://arxiv.org/pdf/2410.14684> — _context engineering — repo-map / RAG over codebase_ (5 claims)
- [primary] <https://arxiv.org/pdf/2505.20182> — _context engineering — repo-map / RAG over codebase_ (5 claims)
- [primary] <https://arxiv.org/html/2602.05892v1> — _context engineering — repo-map / RAG over codebase_ (5 claims)
- [primary] <https://arxiv.org/html/2604.00167v1> — _context engineering — repo-map / RAG over codebase_ (5 claims)

---

## Application to THIS pipeline (operator synthesis, 2026-06-25)

**Validated (already in our design):** fail-closed gate runs the repo's REAL test suite (never model-generated tests — Finding 8's harm-to-weak-models trap avoided); bounded retry / no-progress halt aligns with 'cap ~2 repair rounds' (Finding 7); stage decomposition + #92 model cascade is the Co-PatcheR-validated architecture (Finding 9).

**Two NEW levers the evidence points to (not yet implemented):**
- **(A) search/replace diff editing at write-code** — Finding 4: the structural cure for the F170 class-rename scope-creep (whole-file rewrite is what lets a weak model rename a public symbol). Stronger than the #91 prompt-only 'preserve public symbols' guard.
- **(B) best-of-N + execution-select at write-code/design-tests** — Findings 1, 5, 6: our fail-closed gate IS the verifier; sample N candidates, gate-select the passer. The single best evidence-backed weak-model lever; even N=3–5 with execution-filtering is high-value (voting plateaus ~40, execution-filter does the real work).

_Decision: test #92 (surgical coder) alone first; add a lever only where a drive actually halts — don't gold-plate._
