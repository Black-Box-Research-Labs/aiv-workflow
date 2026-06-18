# Test Anti-Patterns

Shapes that look productive but catch no bugs. If a test you're about to write matches one of these, fix the design before writing the code.

## 1. Pure snapshot tests

```ts
expect(renderReceipt(order)).toMatchSnapshot();
```

**Why it fails the bar:** detects *change*, not *correctness*. Wrong-but-stable output passes. A wrong fix that produces the same wrong string still looks green.

**When it's acceptable:** as a backstop *next to* a semantic test (invariant, differential, etc) that does the actual checking. The snapshot then catches *additional* unintended changes the semantic test missed.

## 2. Mock-everything unit tests

```ts
const mockFs = { readFile: vi.fn().mockResolvedValue("...") };
// test then verifies mockFs.readFile was called with specific args
```

**Why it fails:** verifies the mock contract, not behavior. If the real dependency drifts (different return shape, different error mode), the test stays green. The test is testing the test's own setup.

**When it's acceptable:** at a true seam where the real dependency is genuinely external (third-party API). Even then, prefer integration testing the seam itself periodically.

## 3. Implementation-mirror tests

```ts
function add(a: number, b: number) { return a + b; }
test("add", () => { expect(add(2, 3)).toBe(2 + 3); });   // <- restates impl
```

**Why it fails:** if the implementation is wrong, the assertion is wrong the same way. The test is a tautology.

**Fix:** assert against an *independent* oracle - a hand-computed expected value, a reference implementation, or a mathematical invariant.

## 4. Trivial assertions

```ts
test("foo is a function", () => { expect(typeof foo).toBe("function"); });
test("constants are defined", () => { expect(MAX_LIMIT).toBeDefined(); });
```

**Why it fails:** detects no bug a real user would experience. A type-checker already proves this.

## 5. Format-lock tests

```ts
expect(output).toBe("Hello,    World.");   // exact spacing, exact punctuation
```

**Why it fails:** breaks for cosmetic refactors. Provides no semantic value. The test description usually says "formats correctly" - but format isn't the behavior; the underlying claim is.

**When it's acceptable:** when the format IS the contract (machine-parseable output, wire protocols, on-disk file formats). Then the format *is* the behavior.

## 6. Test-the-private-helper

```ts
import { _internalNormalize } from "./module";
test("_internalNormalize works", ...);
```

**Why it fails:** couples test to implementation. A refactor that inlines or renames the helper breaks the test, even when end-to-end behavior is unchanged. Pocock: *"if your test breaks when you refactor and behavior hasn't changed, those tests were testing implementation."*

**Fix:** test through the public interface that uses the helper. If the helper is too complex to test through the public interface, that's signal that the helper deserves to be extracted to its own module with its own public interface.

## 7. Conditional-mirror tests

```ts
function isWeekend(d: Date) {
  return d.getDay() === 0 || d.getDay() === 6;
}
test("weekend", () => {
  const d = new Date("2026-04-25"); // a Saturday
  if (d.getDay() === 0 || d.getDay() === 6) {  // same condition restated
    expect(isWeekend(d)).toBe(true);
  }
});
```

**Why it fails:** the test contains the same conditional as the code. Both could be wrong together (e.g. off-by-one on day numbering). Test is a no-op.

**Fix:** assert against a hard-coded expected value. `expect(isWeekend(new Date("2026-04-25"))).toBe(true)` - no condition.

## 8. Overly-broad property tests

```ts
fc.assert(fc.property(fc.anything(), input => {
  expect(() => process(input)).not.toThrow();  // catches nothing useful
}));
```

**Why it fails:** "doesn't throw" is too weak. Process could return wrong output silently and pass. Property-based testing only earns its keep when the property is meaningful (round-trip, invariant, monotonicity, idempotence).

## 9. Setup-heavy "test" that's actually fixture-building

A 200-line test where 195 lines are mock setup and the assertion is `expect(result).toBeTruthy()`.

**Why it fails:** the cost of writing the test is dominated by setup; the assertion is weak. The investment doesn't pay back. Either invest in a *strong* assertion proportional to the setup cost, or move the scenario to a higher-level integration/e2e test where the setup is implicit.

## How to know you've written one

After writing a test, ask three questions in order:

1. *"If I refactored this code without changing behavior, would this test fail?"* -> if yes, it's coupled to implementation.
2. *"If the code returned wrong-but-stable output, would this test fail?"* -> if no, it's a snapshot disguised.
3. *"Can I describe the specific real-world failure scenario this test catches?"* -> if no, delete it.

Three "no"s in a row means the test belongs in the suite. Anything else means redesign before commit.
