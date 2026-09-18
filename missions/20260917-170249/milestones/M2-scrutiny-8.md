# M2 scrutiny — round 8

**Mission:** 20260917-170249
**Milestone:** M2 — Conversion engine: CSS
**Round:** 8 (rounds 1–7 all FAIL)
**Date:** 2026-09-17

## Verdict: **FAIL** (not GREEN)

Round 7's two named blockers (B1 allow-list regression, B2 missing pass-through
regression tests) **are genuinely fixed**. All seven focus probes pass. But an
independent AS-069 violation that has been present since F010 and was never
detected in seven rounds is now confirmed, with a repro, and it is *locked in by
a passing test*. A second blocker: the AS-135 end-to-end regression test added by
F073 contains a vacuously-true assertion.

---

## Focus probes (all PASS)

| # | Probe | Result | Expected | Verdict |
|---|-------|--------|----------|---------|
| 1 | `parseCss('.hero{width:100%;height:400px;max-width:1200px;box-shadow:0 2px 4px rgba(0,0,0,.2)}')` | all four in `base`, `warnings: []` | same | PASS |
| 2 | `expandDeclaration('marker','url(#m)')` | `{decls:{}, warning:"shorthand 'marker' is not supported…"}` | `{}` + warning | PASS |
| 3 | `expandDeclaration('position-try','flip-block')` | `{decls:{}, warning:"shorthand 'position-try'…"}` | `{}` + warning | PASS |
| 4 | `mapBreakpoint('SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)')` | `null` | `null` | PASS |
| 5 | `mapBreakpoint('(width <= 991px)')` | `'medium'` | `'medium'` | PASS |
| 6 | `expandDeclaration('font','bold Arial')` | `{decls:{}, warning:"font: expected a length or size keyword…"}` | `{}` + warning | PASS |
| 7 | `expandDeclaration('border','1px solid slid')` | `{decls:{}, warning:"border: unrecognized token 'slid' — declaration dropped"}` | `{}` + warning | PASS |

Round-7 B1 regression sweep (also PASS): `width`, `height`, `min-width`,
`max-width`, `min-height`, `max-height`, `box-shadow`, `text-shadow`,
`transform`, `filter`, `aspect-ratio`, `grid-template-columns`,
`background-blend-mode`, `scroll-snap-type`, `font-variation-settings`,
`-webkit-line-clamp` all pass through verbatim with no warning.

Shorthand deny-list sweep: every key in the `css-shorthand-properties`
vocabulary plus `marker`/`position-try` is either expanded by a dedicated
expander or warn-and-dropped. **One escape found:** `line-clamp` (a real CSS
shorthand for `max-lines`/`block-ellipsis`/`continue`) passes through verbatim —
minor, low real-world impact.

---

## Assertion table

| ID | Status | Reason |
|----|--------|--------|
| AS-053 | FAIL (major) | `margin: 1px 2px 3px 4px 5px` → 4 longhands, **no warning** (invalid CSS half-applied). `margin: ''` → `{decls:{}}` with **no warning** (silent loss). No test for either. |
| AS-054 | FAIL (major) | Identical to AS-053 for `padding`. `padding: ''` silently drops. |
| AS-055 | FAIL (major) | `border: 1px solid var(--c)` → `{decls:{}}` — width and style are discarded along with the unresolvable colour, though both are unambiguous. Test at `longhand.test.ts:730-749` codifies the lossy behaviour. Also `border: 1px solid #zzz` → accepted as a colour (`isColor` accepts any `#`-prefixed token, `longhand.ts:141`). |
| AS-056 | PASS | Single-side expansion correct and tested. |
| AS-057 | FAIL (major) | `border-radius: 1px 2px 3px 4px 5px` → 4 corners, no warning. Elliptical form correctly flattens with a warning. |
| AS-058 | FAIL (major) | `gap: 1px 2px 3px` → row/column only, no warning. Empty value correctly warns. |
| AS-059 | FAIL (major) | `overflow: hidden scroll auto` → `overflow-x/y` only, third value silently dropped. |
| AS-060 | FAIL (major) | `place-items: a b c` → two longhands, third silently dropped. |
| AS-061 | FAIL (major) | `flex: -1` → `flex-basis: -1` (invalid CSS, no warning). `flex: .` → `flex-grow: "."`. `flex: 1 1 1` → unitless `flex-basis: 1`. Numeric guard is `/^[\d.]+$/`, which is not a number grammar. Untested. |
| AS-062 | PASS | `flex-flow` expands and warns on unrecognized tokens. Duplicate-token overwrite (`row row`) is silent — minor. |
| AS-063 | PASS | Single-item transition expands to four longhands; unresolvable duration drops the item with a warning. Third time token silently overwrites delay (`opacity 1s 2s 3s` → `delay: 3s`) — minor. |
| AS-064 | FAIL (major) | Positional alignment breaks when an item is dropped: `transition: color 1s, opacity var(--d), transform 2s` → `property: "color, transform"`, so output position 2 is `transform`, not `opacity`. A warning is emitted but the surviving list is silently re-indexed. No test covers a mixed valid/dropped comma list. |
| AS-065 | **FAIL (blocker)** | **B1** — see below. Also `font: 16px/ Arial` → `{font-size:"16px", line-height:"Arial"}` with no warning and no `font-family` (`longhand.ts:231` collapses `/ ` before tokenising; the line-height half is never validated). |
| AS-066 | PASS | `list-style` expands correctly. Duplicate `url()` silently overwrites `list-style-image`; `image-set()` misclassified as `-type`; `none` sets only `-type` — all minor. |
| AS-067 | PASS | `outline` expands to width/style/color, `auto` accepted as a style. |
| AS-068 | PASS | Global keyword on a shorthand is dropped with a warning, verified for every shorthand in `SHORTHANDS`. |
| AS-069 | **FAIL (blocker)** | **B1.** `expandFont` emits `font-variant`, which is itself a CSS shorthand — and the module's own classifier agrees. |
| AS-070 | PASS | `@media (max-width: 991px)` → `medium`, tested at unit and `parseCss` level. |
| AS-071 | PASS | `@media (max-width: 767px)` → `small`, tested end to end (`css.test.ts:112`). |
| AS-072 | INCONCLUSIVE | `mapBreakpoint('max-width: 479px')` → `tiny` is unit-tested, but there is no `parseCss`-level test labelled AS-072; the only 479px `parseCss` case is incidental inside the `@supports` test (`css.test.ts:351`). Behaviour is correct; traceability is not. |
| AS-073 | INCONCLUSIVE | `mapBreakpoint` unit tests cover 1440/1920/2560 → large/xl/xxl (`breakpoints.test.ts:17-21`), but **no `parseCss` test exists for any min-width media query**. Nothing proves min-width media lands in `variants.large` end to end, unlike AS-070/071. |
| AS-074 | PASS | Behaviourally correct and tested (`css.test.ts:90-98`), though the *labelled* AS-074 test (`breakpoints.test.ts:147`) asserts `variantKey('main', null) === null` — a mirror of `breakpoints.ts:125`, not the assertion's intent. |
| AS-075 | PASS | `background-image: url(...)` in `PASS_THROUGH`, emitted verbatim. |
| AS-076 | PASS | `background-color`/`-position`/`-size`/`-repeat` unaffected. |
| AS-135 | **FAIL (blocker)** | **B2** and **B3** — the AS-069 suite has no output-side sweep, and the F073 end-to-end regression test contains a vacuously-true assertion. |
| AS-136 | PASS | `npm test` → `vitest run`; the converter suite is picked up with no separate command. |
| AS-137 | PASS | `npm run lint` exits clean with the converter included. |

---

## Blockers

### B1 — AS-069 violated: the `font` expander emits `font-variant`, itself a shorthand

`lib/webflow-converter/longhand.ts:251-253`:

```ts
} else if (/^(small-caps)$/i.test(tok) && !filled.has('variant')) {
  out['font-variant'] = 'small-caps';
```

`font-variant` is a CSS shorthand for `font-variant-caps` / `-numeric` /
`-ligatures` / `-alternates` / `-east-asian` / `-position` / `-emoji`. The
module's own classifier agrees — `'font-variant' in shorthandProperties` is
`true`, and the converter *itself* refuses the property when it arrives directly:

```
expandDeclaration('font-variant','small-caps')
  → {decls:{}, warning:"shorthand 'font-variant' is not supported — write longhands instead"}
```

Yet the `font` expander smuggles the same property into the payload with no
warning at all:

```
parseCss('.a{font:small-caps 16px Arial}')
  → base: {"font-variant":"small-caps","font-size":"16px","font-family":"Arial"}
    warnings: []
```

This is a self-inconsistency, not a judgement call: the same property is
simultaneously a shorthand (denied) and a legal output (emitted). AS-069 says no
class may contain **any** shorthand property. There is no downstream emitter or
validator in `lib/` yet (M3 is not built), so `expandDeclaration` is the *only*
AS-069 gate — nothing will catch this later.

**Correct output is `font-variant-caps: small-caps`.**

Severity: **blocker** (AS-065, AS-069).

### B2 — the AS-069 test suite has no output-side sweep, and one test actively locks in the violation

Every AS-069 test asserts only that the shorthand's *own* key is absent from the
output (`longhand.test.ts:1238-1257`, `1351-1373`:
`expect(Object.keys(result.decls)).not.toContain(prop)`). Nothing anywhere
checks that the *emitted* keys are not themselves shorthands. That is precisely
the hole B1 lives in.

Worse, `longhand.test.ts:1100-1103`:

```ts
it('test_AS_065_small_caps_sets_font_variant', () => {
  const result = expandDeclaration('font', 'small-caps 16px Inter');
  expect(result.decls).toMatchObject({ 'font-variant': 'small-caps' });
});
```

This test mirrors the implementation and asserts the AS-069 violation as
intended behaviour. It is green today and would go red on the correct fix.

The missing test: for every property in the independent
`css-shorthand-properties` vocabulary — and for every fixture in the file —
assert `Object.keys(decls).every(k => !isShorthand(k) && !(k in shorthandProperties))`.

Severity: **blocker** (AS-069, AS-135).

### B3 — the F073 end-to-end regression test's warning guard is vacuously true

`lib/webflow-converter/css.test.ts:382`:

```ts
expect(result.warnings.filter((w) => w.includes("is not a recognized")).length).toBe(0);
```

The string `"is not a recognized"` appears **nowhere** in `lib/` — verified by
grep, the only hit is this line itself. The real warning text is
`shorthand '…' is not supported`. This assertion passes regardless of what
`parseCss` does, so the half of the AS-135 regression test that is supposed to
guard against spurious drop-warnings guards nothing. (The positive assertions on
`hero.base[...]` in the same test *are* real and do pass.)

Severity: **blocker** (AS-135) — a regression test with a dead assertion is the
exact failure mode this milestone has been re-run seven times to avoid.

---

## Majors

**MJ-1 — Nested `@media` takes the inner query, discarding the outer.** `css.ts:141`
`walk(node, bp)` replaces the inherited breakpoint instead of intersecting.
Verified: `@media (max-width:479px){ @media (max-width:991px){ .a{color:red} } }`
→ `variants.medium`, **zero warnings**. The true intersection is ≤479px
(`tiny`); the converted style now applies at 480–991px where the author disabled
it. Unsatisfiable nestings are worse:
`@media (min-width:1440px){ @media (max-width:479px){…} }` → `variants.tiny`,
silently. No test exercises nested media at all (`css.test.ts:351` nests inside
`@supports`, where the outer breakpoint is `main`, so the bug is invisible).

**MJ-2 — Cascade order between a media rule and a later base rule is inverted, silently.** `css.ts:176-177`
Buckets are keyed by variant and filled in source order, so order *between*
buckets is lost; in Webflow a breakpoint variant always beats the base. Verified:

```css
@media (max-width:991px){ .a{color:red} }
.a{color:blue}
```
→ `base:{color:blue}, variants.medium:{color:red}`, **zero warnings**. Real CSS
renders blue at all widths; the converted class renders red at ≤991px. Common
pattern in concatenated stylesheets.

**MJ-3 — Box shorthands lose empty values with no warning.** `longhand.ts:407-424`
`margin`, `padding`, `inset`, `border-width`, `border-style`, `border-color` with
an empty value return `{decls:{}}` and **no** `warning`, while every sibling
expander warns `empty value skipped` (`longhand.ts:466-499`). The covering test
(`longhand.test.ts:1056-1061`) asserts `Object.values(decls).every(v => v !== undefined)`
over an empty object — vacuously true, and mirrors the implementation rather
than the warning contract its siblings establish.

**MJ-4 — Over-long value lists are silently truncated** (AS-053/054/057/058/059/060 above).

**MJ-5 — `border`/`outline` with `var()` discard resolvable width and style** (AS-055 above).

**MJ-6 — `font: 16px/ Arial` produces `line-height: Arial`** with no warning and no
`font-family` (AS-065 above). The line-height half is never validated.

**MJ-7 — `css.test.ts:145-148` asserts only `warnings.length > 0`.** Passes if the
warning is about something else entirely, and never checks that the nested
declaration was dropped or that the sibling declaration survived.

---

## Minors

- `line-clamp` (a real shorthand) escapes the deny-list and passes through verbatim.
- `@charset "utf-8"` produces a spurious `@charset is not supported — 0 rule(s) skipped` warning (`css.ts:150-154`).
- Unsupported pseudo-states produce a misleading message: `.a:disabled` → `"not a plain class selector"`. It *is* a plain class selector; the state is unsupported (`css.ts:53` → `:163`).
- Escaped/complex class names are rejected: `.w-1\/2`, `.md\:flex`, `.p-\[2px\]` all → `null` (`css.ts:57`). Warned, not silent, but Tailwind output would lose every utility class.
- `em`/`rem` media boundaries never map — `numeric` is px-only (`breakpoints.ts:74`). `max-width: 61.9375em` (Bootstrap md, exactly 991px) → `null`.
- Top-level declarations outside any block vanish with zero warnings: `parseCss("color:red;")` → empty result, no warning (`css.ts:158`). Every other drop path warns.
- `(width > 1439px)` → `null` (`breakpoints.ts:110-111`) though it is exactly `min-width: 1440px`.
- `@layer` is walked fully transparently; layer priority is ignored, last-writer-wins, silently (`css.ts:142-143`).
- `transition: opacity 1s 2s 3s` → `delay: 3s`, third time token silently overwrites.
- `list-style: disc url(a.png) url(b.png)` → `image: url(b.png)`, silent overwrite; `image-set()` misclassified as `-type`; `list-style: none` sets only `-type`.
- `flex-flow: row row` silently overwrites; no duplicate warning.
- `isColor` accepts any `#`-prefixed token, so `#zzz` passes as a colour.
- Phantom empty class records: `.x.z{} .y.z{}` registers standalone `"z"` with empty `base`/`variants` in both `classes` and `order` (`css.ts:172`).

## Contract tension (on the record, not a defect)

`PASS_THROUGH` (`longhand.ts:370-377`) is checked **before** the shorthand
vocabulary, so `background-position` (→ `-x`/`-y`) and `white-space`
(→ `white-space-collapse`/`text-wrap-mode`) land verbatim despite being formally
shorthands. AS-076 explicitly calls `background-position` a longhand, so the
contract resolves this in favour of pass-through. Flagged only so the conflict is
recorded.

---

## Recommended follow-up features

**FU-M — Fix the `font` expander's `font-variant` emission (blocker, AS-065/AS-069).**
In `lib/webflow-converter/longhand.ts:251-253`, change the small-caps branch to
emit `font-variant-caps: small-caps` instead of `font-variant: small-caps`, and
update the `filled` set key accordingly. Then update
`longhand.test.ts:1100-1103` (`test_AS_065_small_caps_sets_font_variant`) to
assert `font-variant-caps` and to additionally assert that `font-variant` is
*absent* from the output. Add an end-to-end assertion that
`parseCss('.a{font:small-caps 16px Arial}')` produces no key that `isShorthand()`
or the `css-shorthand-properties` vocabulary considers a shorthand, and no
warnings. Also add `line-clamp` to `EXTRA_SHORTHANDS`. Do not touch the
deny-list mechanism otherwise — F072's revert is correct and must stay.

**FU-N — Add an output-side shorthand sweep to the AS-069 suite (blocker, AS-069/AS-135).**
Add a single parameterised test in `longhand.test.ts` that, for every property
key in `Object.keys(shorthandProperties)` plus `marker`/`position-try` plus a
curated list of realistic declarations (every `font`/`border`/`transition`/
`list-style`/`flex`/`place-*`/`outline`/box fixture already in the file), asserts
that **every emitted key** satisfies
`!isShorthand(k) && !(k in shorthandProperties) && !EXTRA_SHORTHANDS.has(k)`,
with `PASS_THROUGH` members explicitly exempted and that exemption list asserted
to be exactly the current `PASS_THROUGH` contents. Add the mirror of this test at
the `parseCss` level, sweeping both `base` **and** every `variants[...]` bucket —
AS-069 names variants explicitly and no current test covers them.

**FU-O — Repair the vacuous assertions in the regression tests (blocker, AS-135).**
Fix `css.test.ts:382` to assert `expect(result.warnings).toEqual([])` rather than
filtering on the never-emitted string `"is not a recognized"`. Fix
`css.test.ts:145-148` to match `/nested @media/` and to assert both that the
nested declaration was dropped and that the sibling base declaration survived.
Fix `longhand.test.ts:1056-1061` to assert the `empty value skipped` warning
rather than a vacuously-true `every(v => v !== undefined)` over `{}`. Then grep
the whole converter test suite for any other assertion whose expected string does
not appear in `lib/webflow-converter/*.ts`, and repair each.

**FU-P — Warn instead of silently discarding in the box and pair expanders (major, AS-053/054/057/058/059/060).**
In `lib/webflow-converter/longhand.ts`, make `box()` and the 1-or-2-value pair
expanders (`gap`, `grid-gap`, `overflow`, `place-items`, `place-content`,
`place-self`) reject value lists longer than the CSS grammar allows: drop the
declaration and warn, rather than half-applying it. Give `margin`, `padding`,
`inset`, `border-width`, `border-style` and `border-color` the same
`empty value skipped` warning their siblings already emit. Add tests for
`>4` values on the box shorthands and `>2` on the pair shorthands, and an
empty-value test for each box shorthand.

**FU-Q — Media-query nesting and cascade-order integrity (major, AS-070–AS-074).**
In `lib/webflow-converter/css.ts`, when `walk` enters an `@media` while the
inherited breakpoint is not `main`, emit a warning naming both queries and skip
the nested block rather than silently replacing the outer breakpoint with the
inner one. Separately, track the source order in which each `(class, property)`
pair is written, and warn when a `main`-breakpoint declaration for a property
arrives *after* a variant declaration of the same property — Webflow variants
always beat the base, so that source ordering cannot be represented and the user
must be told. Add `parseCss` tests for nested media (both the narrowing and the
unsatisfiable case) and for the base-after-media cascade pattern.

**FU-R — Close the `font`, `flex`, `transition` and `border` value-parsing gaps (major, AS-055/AS-061/AS-064/AS-065).**
Validate the line-height half of a `font` slash form with the same rigour as the
size half, so `font: 16px/ Arial` is dropped with a warning instead of producing
`line-height: Arial`. Replace `flex`'s `/^[\d.]+$/` guard with a real CSS number
grammar that rejects negatives, bare `.`, and unitless `flex-basis`, warning on
each. Preserve positional alignment in `expandTransition` when an item is
dropped (emit a placeholder or drop the whole declaration) so AS-064's
position-aligned contract holds. Make `parseBorderParts` emit the width and style
it already resolved when only the colour is an unresolvable `var()`, warning
about the colour alone. Tighten `isColor` so `#zzz` is not accepted as a hex
colour. Add a test for each.

**FU-S — End-to-end traceability for AS-072 and AS-073 (inconclusive → pass).**
Add `parseCss`-level tests, explicitly labelled AS-072 and AS-073, proving that
`@media (max-width: 479px)` lands in `variants.tiny` and that
`@media (min-width: 1440px)` / `1920px` / `2560px` land in `variants.large` /
`xl` / `xxl`. There is currently no `parseCss` test for **any** min-width media
query. Re-label the AS-074 behavioural test at `css.test.ts:90-98` so
traceability lands on it rather than on the `variantKey('main', null)` mirror
test in `breakpoints.test.ts:147`.

**FU-T — Warning-quality pass (minor).**
Suppress the `@charset` false positive; distinguish "unsupported pseudo-state"
from "not a plain class selector"; warn (rather than silently dropping) on
top-level declarations outside any block; name the offending unit when a media
query uses `em`/`rem` boundaries; warn on `@layer` that layer priority is
ignored; warn on the silent overwrites in `transition` (third time token),
`list-style` (duplicate `url()`) and `flex-flow` (duplicate token).

---

## Tool output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  257 passed (257)
   Start at  21:47:59
   Duration  221ms (transform 214ms, setup 236ms, import 178ms, tests 36ms, environment 0ms)
```

**0 failed.** Note: green here does not mean AS-069 holds — see B1/B2.

### `npx tsc --noEmit`

```
(no output — clean)
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no output — clean, exit 0)
```

### Working-tree integrity

`git status --short lib/` is clean. No code, test, or contract file was modified
by this review. All probes were run in scratch test files that were deleted
immediately afterwards.

---

## Summary

- **Round 7 B1 (allow-list regression): FIXED.** F072's revert to the shorthand
  deny-list is the correct mechanism and works.
- **Round 7 B2 (missing pass-through regression tests): PARTIALLY FIXED.** The
  `longhand.test.ts` tests F073 added are real. The `css.test.ts` end-to-end test
  it added contains a dead assertion (B3).
- **Three new blockers:** B1 (AS-069 `font-variant` emission), B2 (no output-side
  shorthand sweep, plus a test that locks in the violation), B3 (vacuous
  assertion in the AS-135 regression test).
- **Seven majors**, mostly silent data loss and silently-inverted cascade.

**Status: FAIL. Not GREEN. Recommend FU-M, FU-N, FU-O as round-9 blockers;
FU-P through FU-T as follow-ups.**
