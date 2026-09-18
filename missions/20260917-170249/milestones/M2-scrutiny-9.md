# M2 Scrutiny — Round 9

**Verdict: PASS (GREEN)**

Round 8 fix verified. All round-1..8 blockers are resolved. Test suite,
typechecker and linter are clean.

## Gate results

| Gate | Result |
|---|---|
| `npx vitest run lib/webflow-converter/` | **258 passed / 0 failed** (4 files) |
| `npx tsc --noEmit` | clean (exit 0, no diagnostics) |
| `npm run lint` | clean (no output, no warnings) |

## Focus probes (round-8 blockers)

| # | Probe | Result |
|---|---|---|
| 1 | `expandDeclaration('font','small-caps 16px Arial')` | `{font-variant-caps:'small-caps', font-size:'16px', font-family:'Arial'}` — **no `font-variant` key**. PASS |
| 2 | `isShorthand('font-variant-caps')` | `false` — correctly classified as longhand. PASS |
| 3 | AS-069 output-side sweep test in `longhand.test.ts` | present (~line 1283) and passing. PASS with caveat (see MAJOR-1) |
| 4 | `css.test.ts` hero end-to-end dead filter | fixed — assertions are now direct `expect(hero.base[...]).toBe(...)` plus `expect(result.warnings).toHaveLength(0)`. PASS |
| 5 | `parseCss('.a{font:small-caps 16px Arial}')` | base = `{font-variant-caps, font-size, font-family}`, no `font-variant`, 0 warnings. PASS |
| 6 | Sweep: every expander's output keys vs `isShorthand()` | **0 violations** across all 16 implemented expanders (margin, padding, inset, border*, border-radius, flex, flex-flow, transition, outline, list-style, font, gap, grid-gap, overflow, place-*). PASS |
| 7 | `tsc --noEmit` | clean. PASS |
| 8 | `npm run lint` | clean. PASS |

Additional probe: `font-variant` as a *direct input* is warned-and-dropped
(`decls:{}`, warning `"shorthand 'font-variant' is not supported — write
longhands instead"`), and `parseCss('.a{font-variant:small-caps}')` yields an
empty base. The shorthand cannot reach a payload from either the `font`
expander path or the direct-declaration path.

## Assertion results

| ID | Status | Reason |
|---|---|---|
| AS-065 | **PASS** | `font` shorthand expands weight/style/size/line-height/family; `small-caps` now maps to the `font-variant-caps` longhand; system-font keywords (`caption`) drop with a warning. Guarded by behaviour-specific tests that assert output key names, not implementation structure. |
| AS-069 | **PASS** | No expander emits a shorthand key. Verified independently by an exhaustive 16-expander output sweep (0 violations) and by the direct-input drop path, which ORs the `css-shorthand-properties` vocabulary, `EXTRA_SHORTHANDS`, and vendor-prefix stripping. |
| AS-135 | **PASS** | Unit coverage exists for every rule in AS-053–AS-068; the AS-135 end-to-end `parseCss` regression test now carries real assertions rather than a vacuous filter. |

## Non-blocking findings

**MAJOR-1 — `isShorthand()` is narrower than the drop path it is trusted to mirror.**
`lib/webflow-converter/longhand.ts:295`:

```ts
export const isShorthand = (prop: string): boolean => SHORTHANDS.has(prop.toLowerCase().trim());
```

`SHORTHANDS` contains only the shorthands that have a *dedicated expander*. The
actual rejection decision at line 559 is much wider:

```ts
if (isShorthand(p) || inVocab || inExtra || isVendorShorthand) {
```

Consequence: `isShorthand('font-variant')` returns `false` even though
`font-variant` is a real CSS shorthand and *is* correctly dropped at runtime
(via `EXTRA_SHORTHANDS`). The new sweep loop in the AS-069 test —
`for (const key of Object.keys(result.decls)) expect(isShorthand(key)).toBe(false)`
— would therefore **not** have caught the round-7 regression it was written to
prevent. The test only holds because of its explicit companion line
`expect(result.decls['font-variant']).toBeUndefined()`.

The assertion is genuinely guarded today, so this is not a blocker. But the
guard is load-bearing on one hardcoded property name rather than on the
predicate, so the same class of bug in a different shorthand (e.g. an expander
emitting `font-synthesis`, `overscroll-behavior`, or `marker`) would slip
through the sweep. Severity: **major (met but fragile)**.

**MINOR-1 — two shorthand vocabularies with no shared accessor.** `SHORTHANDS`,
`shorthandProperties` (npm vocab) and `EXTRA_SHORTHANDS` are consulted together
in exactly one place. Any future caller that reaches for `isShorthand()` alone
inherits MAJOR-1.

## Recommended follow-up features

**F-followup-A — Unify shorthand classification behind one predicate.**
Introduce a single exported predicate (e.g. `isRejectedShorthand(prop)`) that
encapsulates the full decision currently inlined at `longhand.ts:559`: local
`SHORTHANDS` membership, `css-shorthand-properties` vocabulary membership,
`EXTRA_SHORTHANDS` membership, and vendor-prefix-stripped retry. Refactor the
expandDeclaration drop path to call it so there is exactly one definition of
"is a shorthand". Keep the existing narrow `isShorthand()` only if some caller
genuinely needs "has a dedicated expander" semantics, and if so rename it to
`hasExpander()` so the two cannot be confused. Then rewrite the AS-069 output
sweep in `longhand.test.ts` to assert against the unified predicate, which makes
the sweep actually capable of catching an expander that emits any shorthand
rather than only the one hardcoded `font-variant` case. No behaviour change is
expected; the full 258-test suite should stay green, and the refactor's value is
that the AS-069 guard stops depending on a single literal property name.

**F-followup-B — Property-based AS-069 guard over the whole expander surface.**
Add a generated test that, for every property with a dedicated expander, feeds a
representative value and asserts that no emitted key satisfies the unified
shorthand predicate from F-followup-A — the sweep this reviewer ran manually
(16 expanders, 0 violations) promoted into a permanent test. Drive the property
list from the expander dispatch table itself rather than a hand-maintained
array, so a newly added expander is covered automatically and cannot regress
AS-069 without failing CI.

## Appendix — full gate output

### `npx vitest run lib/webflow-converter/`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  258 passed (258)
   Start at  22:00:39
   Duration  219ms (transform 215ms, setup 237ms, import 177ms, tests 35ms, environment 0ms)
```
(Preceded only by a Vite `configLoader: 'native'` ESM/CJS advisory concerning
`vitest.config.ts` and `tests/realtime-live-delivery-tests.ts`; not a failure.)

### `npx tsc --noEmit`
```
(no output — exit 0)
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

(no output — clean)
```

### Manual sweep probe (not committed; scratchpad only)
```
font-variant direct:      { decls: {}, warning: "shorthand 'font-variant' is not supported — write longhands instead" }
parseCss font-variant:    {}
sweepViolations:          []
```
