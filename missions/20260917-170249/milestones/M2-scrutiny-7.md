# M2 Scrutiny — Round 7

**Verdict: FAIL (RED).** Round-6 fixes resolved all 11 focus probes, but F071
(whitelist inversion) introduced a new, higher-severity regression that makes the
converter unusable on ordinary CSS.

Tooling: `npx tsc --noEmit` clean. `npm run lint` clean.
`npx vitest run lib/webflow-converter/` — 4 files, **251 passed, 0 failed**.

## Focus probes (round-6 blockers) — all now correct

| # | Probe | Result |
|---|---|---|
| 1 | vitest converter suite | 251 passed / 0 failed |
| 2 | `font: bold Arial` | `{}` + warning (family in size slot) — PASS |
| 3 | `font: normal normal 14px Arial` | style/weight/size/family all correct — PASS |
| 4 | `border: 1svh solid red` | width `1svh`, style `solid`, color `red` (×4 sides) — PASS |
| 5 | `border: 1px solid slid` | `{}` + "unrecognized token 'slid'" — PASS |
| 6 | `mapBreakpoint('SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)')` | `null` — PASS |
| 7 | `mapBreakpoint('screenand (max-width:991px)')` | `null` — PASS |
| 8 | `mapBreakpoint('(width <= 991px)')` | `'medium'` — PASS |
| 9 | `marker: url(#m)` | `{}` + warning — PASS |
| 10 | `position-try: flip-block` | `{}` + warning — PASS |
| 11 | `color: red` | `{color:'red'}` — PASS |

## Assertion ledger

| ID | Status | Reason |
|---|---|---|
| AS-048 | PASS | Anchored case-insensitive whitelist grammar; all 3 adversarial inputs correct. Minor gap: `(max-width:991.98px)` → `null` (Bootstrap-style fractional breakpoints unmapped). |
| AS-055 | PASS | Explicit `isColor` classifier; modern units accepted; bogus keyword warns and drops. |
| AS-065 | PASS | Font-size slot validated as length/keyword; stateful prefix loop. |
| AS-068 | PASS | Global keyword on shorthand drops with warning (`gap: inherit`, `border-radius: inherit`, `text-decoration: inherit` all verified). |
| **AS-069** | **FAIL — blocker** | Satisfied only by dropping the CSS vocabulary wholesale. See B1. |
| **AS-135** | **FAIL — blocker** | 251 tests are blind to `width`/`height`/`box-shadow`. See B2. |

## Blockers

### B1 — F071 whitelist inversion silently drops core CSS properties

`lib/webflow-converter/longhand.ts:397` `LONGHAND_ALLOW_LIST` omits the most
common properties in CSS. `lib/webflow-converter/longhand.ts:621` warn-and-drops
anything not on it, and `lib/webflow-converter/css.ts:182` wires that straight
into the real conversion pipeline.

End-to-end through `parseCss`:

```
.hero{width:100%;height:400px;max-width:1200px;min-height:50vh;
      box-shadow:0 2px 4px rgba(0,0,0,.2);color:#333;}
```
produces five dropped declarations:
```
.hero: 'width' is not a recognized Webflow property — declaration dropped
.hero: 'height' is not a recognized Webflow property — declaration dropped
.hero: 'max-width' is not a recognized Webflow property — declaration dropped
.hero: 'min-height' is not a recognized Webflow property — declaration dropped
.hero: 'box-shadow' is not a recognized Webflow property — declaration dropped
```

Confirmed missing from the allow-list and dropped: `width`, `height`,
`min-width`, `max-width`, `min-height`, `max-height`, `box-shadow`,
`text-shadow`, `isolation`, `scroll-behavior`, `touch-action`, `caret-color`,
`accent-color`, `tab-size`, `transform-style`. Every one is a Webflow-native
style property. `width` and `height` alone appear in essentially every
real-world stylesheet — the converter now produces empty classes for them.

AS-069 only forbids *shorthands* in the output. It does not license dropping
unknown *longhands*. The inversion overshoots the assertion and trades a
cosmetic violation for a functional one.

### B2 — the test suite cannot detect B1

`grep` for `'width'`, `min-width`, `box-shadow` across
`lib/webflow-converter/longhand.test.ts` and `css.test.ts` returns **zero**
assertions that these properties survive expansion (only one incidental hit at
`longhand.test.ts:1360` for `-webkit-box-shadow` as a shorthand). A change that
deletes `width` support from the converter passes 251/251. This is the textbook
case of tests mirroring the implementation rather than the behaviour, and it
fails AS-135's requirement of coverage for the named rules.

## Recommended follow-up features

**F072 — replace the longhand allow-list with a shorthand deny-list.** Invert
F071 back, but keep AS-069 satisfied by the correct mechanism: maintain an
explicit set of *shorthand* property names (the existing `SHORTHANDS` +
`EXTRA_SHORTHANDS`) and warn-and-drop only properties that are in that set yet
have no expander case. Every other property — known longhand or not — passes
through verbatim. This satisfies AS-069 ("no shorthand in output") without
destroying unrecognised-but-valid longhands, and removes the ongoing maintenance
burden of enumerating the entire CSS property vocabulary, which is open-ended and
grows every year.

**F073 — behavioural regression tests for longhand pass-through.** Add a test
that runs a realistic stylesheet (the kind a designer actually exports: `width`,
`height`, `min/max-width`, `min/max-height`, `box-shadow`, `text-shadow`,
`transform-style`, `touch-action`, `isolation`, `caret-color`, `accent-color`,
`tab-size`, `scroll-behavior`) through `parseCss` and asserts each declaration
appears in the output class with its original value and produces **no** warning.
The test must be written from the CSS spec's property list, not from the
converter's internal sets, so it fails if pass-through is ever narrowed again.

**F074 — fractional breakpoint tolerance (minor).** `mapBreakpoint` returns
`null` for `(max-width:991.98px)`, the Bootstrap convention. Decide explicitly
whether to snap fractional widths within 1px of a Webflow breakpoint or to keep
rejecting them; either is defensible, but the current behaviour is an unexamined
side effect of the exact-match grammar rather than a decision.

**F075 — breakpoint grammar false negatives (minor, all warned not silent).**
Independent review of `mapBreakpoint` found no false positives (exact numeric
equality, anchored regexes, longest-first prefix stripping all hold), but several
valid queries return `null` and lose their rules with only a warning:
`em`/`rem` widths (`breakpoints.ts:74` accepts `px` only, so Tailwind/Bootstrap's
`47.9375em` is unmapped); bare range syntax `width <= 991px` without wrapping
parens (`:81-84`, inconsistent with `max-width:` which accepts the bare form);
reversed ranges `(991px >= width)`; `(width > Npx)` hard-coded null at `:111`
even when `N+1` is a real min-width boundary; and range-bounded
`(min-width:768px) and (max-width:991px)`, which is how hand-written CSS
normally expresses Webflow's `medium` tier. Separately, `css.ts:135-141` drops
nested `@media screen { @media (max-width:767px) {...} }` wholesale because the
outer params map to null and the branch returns before recursing, whereas
`@supports`/`@layer` do recurse (`:142`). Decide which of these to support.

## Appendix — tool output

### npx vitest run lib/webflow-converter/
```
 Test Files  4 passed (4)
      Tests  251 passed (251)
   Duration  221ms
```

### npx tsc --noEmit
```
(no output — clean)
```

### npm run lint
```
> pm-app@0.1.0 lint
> eslint
(no findings)
```
