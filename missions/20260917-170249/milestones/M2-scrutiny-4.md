# M2 scrutiny — round 4 — Conversion engine: CSS (F005–F014, F051–F062)

_Mission 20260917-170249 · 2026-09-17 · read-only adversarial re-review_

## VERDICT: **FAIL** — 3 blockers, 11 majors

The milestone **ships a red test suite at HEAD** (`fcf82ae3`, working tree
clean for `lib/`): `202 tests, 1 failed`. The failing test is the AS-076 test,
and it fails because the code now violates AS-076.

Round 3's blocker B1 was addressed by swapping the hand-written `SHORTHANDS`
whitelist for the `css-shorthand-properties` package. That fixed the
vendor-prefix leak and about two-thirds of the named omissions, but it traded
one incomplete list for another and introduced a second, worse failure mode
the previous rounds did not have: the package **over-fires** on
`background-position`, so a longhand the contract explicitly protects is now
warned-and-dropped. No test guards the over-fire direction — the one that
would have caught it is the AS-076 test, and it was left failing rather than
investigated.

Several round-3 majors are genuinely fixed and verified by probe: unitless
zero (`border: 0`, `outline: 0`), `outline-style: auto`, all four `font`
defects, `transition`'s unknown-token clobber, and the min+max / negated /
`only` / comma-list media queries.

Two round-3 fixes, however, were applied narrowly enough that the defect simply
relocated, and both re-fail this round. AS-048's parser now rejects four named
compound shapes but still maps `print and (max-width:767px)` to `small`.
AS-135's AS-051/AS-052 mislabels were deleted, and nine new mislabels
(five `AS_057`, two `AS-039`, two `AS-048`) took their place — the third
consecutive round in which a label-by-label correction has produced a fresh
crop, which is the audit mechanism failing, not the labels.

Net: the milestone is further from green than it was in round 3, which was at
least green on the suite.

---

## Round-3 blocker and majors: re-verified by probe

| Round 3 | Now | Probe evidence |
|---|---|---|
| **B1 / AS-069** whitelist escape hatch | **PARTIALLY FIXED — still FAIL** | Vendor prefixes now caught (`-webkit-transition`, `-ms-flex`, `-o-transition`, `-webkit-columns` → warn+drop). `column-rule`, `font-variant`, `mask-border`, `scroll-snap-margin` now caught. **Still leaking verbatim, no warning:** `overscroll-behavior`, `border-inline-start`, `border-inline-end`, `border-block-start`, `border-block-end`, `contain-intrinsic-size`, `font-synthesis`, `animation-range`, `scroll-timeline`, `view-timeline`, `grid-template-areas`, `-webkit-box-shadow`. See NB3. |
| M-a / AS-063 `var(--ease)` | **FIXED** | `transition: opacity .2s var(--ease)` → `transition-property:"opacity"` + warning `unrecognized token "var(--ease)" skipped`. |
| M-b / unitless zero | **FIXED** | `border: 0` → four `border-*-width:"0"`. `outline: 0` → `outline-width:"0"`. `border: 0 solid red` correct on all four sides. |
| M-c / `undefined`-valued keys | **NOT FIXED** | `margin`/`padding`/`inset`/`font`/`outline`/`list-style`/`border` guarded. `gap`, `overflow`, `place-*`, `flex` still emit `undefined`; `transition` emits four **empty-string** longhands. See M-c below. |
| M-d / compound media | **FIXED** | `(min-width:768px) and (max-width:991px)` → `null`; `not all and (max-width:767px)` → `null`; `only screen and (...)` → `null`; comma lists → `null`. `@media (max-width:800px)` warns and skips. |
| M-e / `font` | **FIXED** | `font: 16px / 1.5 Arial` → size+line-height+family. `font: 1000 14px Inter` → weight 1000. `small-caps` → `font-variant`. `font: caption` → warn+drop. |
| M-f / `outline-style: auto` | **FIXED** | `outline: 2px auto -webkit-focus-ring-color` → width+style+color, all three correct. |
| M-g / AS-135 mislabels | **FIXED** | AS-051 and AS-052 no longer appear anywhere in `lib/webflow-converter/*.test.ts`; both now correctly read as uncovered until M3. |

---

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-039 | PASS | — | `.card` → one class definition; standalone and combo coexist as separate entries. |
| AS-040 | PASS | — | `.card.is-featured` → `card\|is-featured` with `comboOf:["card"]`; base classes also materialised. |
| AS-041 | PASS | minor | All eight states map; `:active`→`pressed`. `.x::hover` (invalid) still silently accepted. |
| AS-042 | PASS | — | Descendant → warning, 0 classes. |
| AS-043 | PASS | — | ID → warning, 0 classes. |
| AS-044 | PASS | — | `>`/`+` → warning, 0 classes. |
| AS-045 | PASS | — | Attribute → warning, 0 classes. |
| AS-046 | PASS | minor | Flag dropped, decl applied, warning names the property. |
| AS-047 | N/A | — | HTML-side (M3). |
| AS-048 | **FAIL** | major | Bare `print`, `800px`, min+max compound, negated, `only`, comma-lists warn-and-skip. But `print and (max-width:767px)` → `small`, `tv and (max-width:479px)` → `tiny`, `(max-width:767px) and (orientation:landscape)` → `small` — all silent. AS-048 names `print` explicitly; only its bare form is rejected. Same-axis compounds take the first condition, not the intersection. |
| AS-049 | PASS | — | Warns "move it to page custom code", no style. |
| AS-050 | PASS | — | Warns "upload the font in Webflow site settings", no style. |
| AS-051 | N/A | — | HTML-side (M3); correctly has no test and no false label. |
| AS-052 | N/A | — | Same. |
| AS-053 | PASS | minor | 1/2/3/4-value rule correct; `var()`/`calc()` preserved; empty guarded. `margin: 1px 2px 3px 4px 5px` silently truncates the 5th. |
| AS-054 | PASS | major | Same path, same truncation. |
| AS-055 | **FAIL** | major | `border: 0` / `border: 0 solid red` now correct. But `parseBorderParts` keeps only the *first* token of each role and discards the rest silently: `border: 1px 2px solid red` → `border-*-color:"2px"` and **`red` vanishes entirely**; `border: var(--w) var(--s) var(--c)` → `border-*-color:"var(--w)"` only, **no width and no style on any side**. The assertion requires width/style/color on all four sides. |
| AS-056 | PASS | — | Only the named side's three longhands. |
| AS-057 | PASS | — | 1–4 values TL/TR/BR/BL; `calc(100%/2)` not split; empty and leading-slash guarded. |
| AS-058 | PASS | major | 1→both, 2→row/column, `grid-gap` aliased. `gap:` (empty) emits `row-gap`/`column-gap` with **`undefined`** values, no warning. `gap: 1px 2px 3px` drops the third silently. |
| AS-059 | PASS | major | 1→both, 2→x/y. `overflow:` emits `undefined`-valued keys. |
| AS-060 | PASS | major | All three pairs correct; `place-items:` emits `undefined`-valued keys; extras dropped silently. |
| AS-061 | PASS | major | Keyword/numeric/2-value/3-value/calc-basis spec-correct. `flex:` emits `undefined`-valued keys. `flex: none extra` → `flex-grow:"none"` — the 2-value branch never validates part 0. |
| AS-062 | **FAIL** | major | `flex-flow: wrap row extra` → `flex-wrap:"wrap"`, `flex-direction:"extra"`, **no warning**. An unknown token still overwrites a real longhand — FU-M2-17 explicitly named `flex-flow` and it was not done. |
| AS-063 | PASS | major | Single item → four longhands; unknown tokens now warned. `transition:` (empty) emits all four longhands with **empty-string values** and no warning. |
| AS-064 | PASS | — | Paren-aware comma split; positional alignment holds for 2 and 3 items; `cubic-bezier`/`steps` survive. |
| AS-065 | PASS | major | Round-3 defects all closed (spaced slash, weight 1000, `small-caps`, system keywords). New: valid CSS the parser does not model produces garbage longhands with no warning — `font: condensed 16px Arial` → `{font-size:"condensed", font-family:"16px Arial"}`; `font: oblique 20deg 16px Arial` → `font-size:"20deg"`. |
| AS-066 | **FAIL** | major | `list-style: disc foo bar` → `{list-style-type:"bar"}`. A **valid** `list-style-type` (`disc`) is destroyed by two unknown tokens, last-wins, no warning. FU-M2-17 named `list-style` and it was not done. |
| AS-067 | PASS | — | `outline: 0`, `outline: 2px auto -webkit-focus-ring-color`, `outline: 2px solid red` all correct. |
| AS-068 | PASS | — | Case-insensitive, gated on `isShorthand`, `{}` + warning. |
| AS-069 | **FAIL** | **blocker** | See NB3. |
| AS-070 | PASS | — | 991 → `medium`; `@media`+state → `medium_hover`. |
| AS-071 | PASS | — | 767 → `small`. |
| AS-072 | PASS | — | 479 → `tiny`. |
| AS-073 | PASS | — | 1440/1920/2560 → large/xl/xxl. |
| AS-074 | PASS | — | No media query → base. |
| AS-075 | PASS | — | `url("/img/hero.jpg")` byte-identical, quotes intact. |
| AS-076 | **FAIL** | **blocker** | See NB2. `background-position` is dropped. The test asserting this fails. |
| AS-135 | **FAIL** | major | The AS-051/AS-052 mislabels are gone, but the defect moved: `css.test.ts:132,139,144,149,154` are five tests named `test_AS_057_*` that test nested rules and unknown at-rules and never touch `border-radius` or corner order; `css.test.ts:170,181` are labelled AS-039 while testing combo-to-base linkage (AS-040's subject); `breakpoints.test.ts:74,78` are labelled AS-048 while asserting *positive* mappings (AS-071's subject). AS-074's only labelled test asserts `variantKey('main', null) === null` — a helper return value, not the behaviour. And a coverage claim is void while the suite is red. |

---

## Blockers

### NB1 — the milestone ships a failing test suite

`git status` shows `lib/webflow-converter/` clean at `fcf82ae3`. Running the
suite at that commit:

```
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 201 passed (202)
```

Round 3 recorded 187/187 green. The final round-3 remediation commit turned
the suite red and was committed anyway. Whatever the individual assertion
verdicts, a milestone cannot be accepted in this state, and AS-135's
"automated unit tests covering…" cannot be satisfied by a suite that does not
pass.

### NB2 — AS-076: `background-position` is warned-and-dropped

AS-076 reads, verbatim: *"Other `background-*` longhand properties on the same
class (e.g. `background-color`, `background-position`) are unaffected by the
presence of `background-image`."* The assertion names `background-position`.

```
parseCss('.hero{background-image:url("/a.png");background-position:50% 50%;background-color:red}')
 base     = { 'background-image':'url("/a.png")', 'background-color':'red' }
 warnings = [".hero: shorthand 'background-position' is not supported — write longhands instead"]
```

`background-position` is dropped whether or not `background-image` is present:

```
parseCss('.x{background-position:center;color:red}')
 -> warnings ["… shorthand 'background-position' is not supported …"], no position
```

Cause: `css-shorthand-properties` classifies `background-position` as a
shorthand (of the non-standard `background-position-x`/`-y`), and the new
`default:` branch trusts the package unconditionally. Webflow accepts
`background-position` directly; every stylesheet that positions a background
image now loses it.

This is a **regression**, not a pre-existing gap: the AS-076 test passed in
round 3 and fails now. The failure mode is the exact inverse of B1 — the
vocabulary firing where it must not — and nothing in the suite tests that
direction. `test_AS_069_independent_vocabulary_…` and
`test_AS_069_unsupported_shorthands_from_independent_vocabulary_are_dropped_with_warning`
both iterate `Object.keys(shorthandProperties)` and assert the property *is*
dropped; they would happily green-light dropping every property in CSS.

The same over-fire hits `grid-row` and `grid-column`, which are now dropped
with a warning. That is defensible under AS-069, but it is a behaviour change
no one appears to have chosen, and no test records the choice.

Full list of properties the package causes to be warned-and-dropped:
`background`, `background-position`, `border-image`, `font-variant`, `grid`,
`grid-template`, `grid-row`, `grid-column`, `grid-area`, `mask`, `mask-border`,
`columns`, `column-rule`, `scroll-padding`, `scroll-padding-block`,
`scroll-padding-inline`, `scroll-snap-margin`, `scroll-snap-margin-block`,
`scroll-snap-margin-inline`, `cue`, `pause`, `rest`, `text-decoration`,
`text-emphasis`, `animation`.

### NB3 — AS-069: real shorthands still reach the payload verbatim

The independent vocabulary has **43 entries** and predates CSS logical
properties. Everything it omits still falls through `default:` and is emitted
byte-for-byte with no warning:

```
overscroll-behavior:    {"decls":{"overscroll-behavior":"foo bar"}}
border-inline-start:    {"decls":{"border-inline-start":"foo bar"}}
border-inline-end / border-block-start / border-block-end:  same
contain-intrinsic-size: {"decls":{"contain-intrinsic-size":"foo bar"}}
font-synthesis:         {"decls":{"font-synthesis":"foo bar"}}
animation-range / scroll-timeline / view-timeline:          same
grid-template-areas:    {"decls":{"grid-template-areas":"foo bar"}}
-webkit-box-shadow:     {"decls":{"-webkit-box-shadow":"foo bar"}}
```

At payload level:

```
parseCss('.x{overscroll-behavior:contain none}')
 -> base {'overscroll-behavior':'contain none'}, warnings []
@media (max-width:479px){ .y:hover{ overscroll-behavior:contain } }
 -> y.variants.tiny_hover = {'overscroll-behavior':'contain'}, warnings []
```

Round 3's FU-M2-14 named `overscroll-behavior`, `border-block-start`,
`border-block-end`, `border-inline-start`, `border-inline-end`,
`contain-intrinsic-size`, `font-synthesis`, `animation-range`,
`scroll-timeline`, `view-timeline` as the minimum the set must gain. **None of
those ten are handled.** They were transcribed into
`test_AS_069_shorthand_vocabulary_whitelist_recognizes_all_missing_properties`
only in their *parent* forms (`border-inline`, `border-block`,
`margin-inline`, `inset-inline`), which `isShorthand` does return `true` for —
so the test greens while the `-start`/`-end` variants that real CSS actually
uses leak.

The structural criticism from round 3 therefore stands in a new form: the test
corpus and the dispatch table are still the same object (`shorthandProperties`
on one side, the union with `SHORTHANDS` on the other). No test can observe an
omission from *both*, which is precisely what these ten properties are. The
vocabulary needs a third-party cross-check (e.g. `mdn-data`'s
`css/properties.json`, where every shorthand carries an explicit
`computed: …`/`groups` relationship), not a second hand-list.

---

## Majors

- **M-a — AS-062/AS-066: an unknown token still overwrites a real longhand.**
  `flex-flow: wrap row extra` → `flex-direction:"extra"`;
  `list-style: disc foo bar` → `list-style-type:"bar"`, discarding the valid
  `disc`. Both silent. FU-M2-17 fixed only `transition` of the three it named.
- **M-b — `transition:` (empty) emits four empty-string longhands.**
  `{"transition-property":"", "transition-duration":"", "transition-timing-function":"", "transition-delay":""}`,
  no warning. An empty-string CSS value is invalid and will be pasted as such.
- **M-c — `gap`/`overflow`/`place-*`/`flex` still emit `undefined` values.**
  `parseCss('.a{ gap:; overflow: }')` → `base` entries
  `[['row-gap',undefined],['column-gap',undefined],['overflow-x',undefined],['overflow-y',undefined]]`,
  warnings `[]`. `margin`/`padding`/`inset`/`font`/`outline`/`list-style`/
  `border` were guarded; these four were not. FU-M2-16 also asked for a
  suite-wide walk that fails if any emitted value is not a non-empty string —
  that test does not exist, which is why the gap survived a targeted fix.
- **M-d — `border: 1px solid red blue` discards `blue` in silence.** FU-M2-15
  asked for a warning on any token `parseBorderParts` cannot place. Not done.
- **M-e — Box-rule `>4` values truncated silently** (`margin: 1px 2px 3px 4px 5px`),
  as is `gap`'s third value and `place-*` extras.
- **M-f — AS-048: a compound `@media` silently discards the disqualifying
  condition.** `mapBreakpoint` rejects comma lists, `not`, `only`, and
  min+max compounds, but nothing else. `print and (max-width:767px)` → `small`;
  `tv and (max-width:479px)` → `tiny`;
  `(max-width:767px) and (orientation:landscape)` → `small`. Print-only and
  orientation-only styles are promoted into a real Webflow breakpoint with zero
  warnings. `(max-width:991px) and (max-width:767px)` → `medium`, the wrong
  intersection.
- **M-g — Nested `@media` takes the inner breakpoint, not the intersection.**
  `@media (max-width:767px){@media (max-width:991px){.c{color:red}}}` →
  `variants.medium`, warnings `[]`. A mobile-only style lands on tablet.
  `walk()` recurses with the inner `bp` and overwrites the outer.
- **M-h — AS-055: `parseBorderParts` keeps only the first token per role and
  drops the rest in silence.** `border: 1px 2px solid red` puts `2px` in the
  colour slot and loses `red` outright; `border: var(--w) var(--s) var(--c)` —
  the tokenised pattern this repo's own design system uses — yields nothing but
  `border-*-color: var(--w)`, so width and style never land on any side.
- **M-i — AS-065: unmodelled but valid `font` values become garbage longhands.**
  `font-stretch` keywords and angled `oblique` are not recognised, so
  `font: condensed 16px Arial` reports `font-size: "condensed"` and
  `font-family: "16px Arial"` with no warning.
- **M-j — AS-135: the mislabel defect moved rather than being fixed.** Nine
  tests carry an assertion ID whose subject they do not test (five `AS_057`,
  two `AS-039`, two `AS-048`). A grep-based coverage audit still returns false
  passes — for AS-057 it now claims eight tests where three exist.
- **M-k — No test covers the over-fire direction of the shorthand vocabulary.**
  Every AS-069 test asserts "this property is not emitted". Nothing asserts
  "this longhand *is* emitted". NB2 is the direct consequence, and the same
  hole will swallow the next package bump.

## Minors

- `.x::hover` (invalid double-colon) accepted as hover.
- `flex: none extra` → `flex-grow: "none"`.
- `list-style: square circle` / `flex-flow: row wrap column-reverse` — last token wins, earlier valid value overwritten.
- `.card{margin:inherit !important}` emits both `dropped "margin: inherit"` **and** `"!important" on margin was dropped`, implying something was applied when the whole declaration was dropped.
- `@media print{...}` warns without a rule count while unknown at-rules report `N rule(s) skipped`.
- `@charset "utf-8";` → `@charset is not supported — 0 rule(s) skipped`, a nonsense warning for a benign directive.
- `(width >= 1440px)` → `null` while `(min-width:1440px)` → `large`; range syntax is supported in one direction only, with no warning on the other.
- `.café{...}` rejected as a non-class selector alongside the Tailwind-escape case.
- `@supports` and `@layer` still unwrapped unconditionally with no warning.
- `(max-width:0991px)` → `medium` via `parseFloat`.
- Tailwind-escaped class names (`.w-1\/2`) rejected with the generic
  non-plain-selector warning; nothing pins this either way.
- Empty variant buckets still created when a media block's declarations are
  all dropped.
- `missions/.../handoffs/` has no `F059`, `F061`, or `F062` handoff (F062's
  exists; F059 and F061 do not), so three features in the M2 follow-up chain
  have no written record.

## Behaviour changes no current test would catch

- Any property `css-shorthand-properties` classifies differently after a
  version bump — in either direction.
- Whether `background-position`, `grid-row`, `grid-column` are preserved or
  dropped (the one test that covered this is currently red).
- Emission of `undefined` or `""` values from `gap`/`overflow`/`place-*`/
  `flex`/`transition`.
- `flex-flow` / `list-style` unknown-token clobbering.
- The `>4`-value truncation rule.
- `border`'s leftover-token discard, and the first-token-per-role rule.
- Zero-padded media-query widths; `print and (...)`, `orientation`, and any other unmodelled media feature.
- Nested `@media` resolution order.
- `font-stretch` / angled-`oblique` handling.

---

## Recommended follow-up features

**FU-M2-21 — Restore `background-position` and pin the longhand-preservation
direction (blocker).** `css-shorthand-properties` classifies
`background-position` as a shorthand of the non-standard
`background-position-x`/`-y`; the new `default:` branch trusts it and drops the
declaration, which directly contradicts AS-076's own wording and has left the
AS-076 test failing at HEAD. Introduce an explicit allow-list of properties
that Webflow accepts as-is and that must never be routed to the warn-and-drop
branch regardless of what the vocabulary says — `background-position` at
minimum, and a considered decision (recorded, not implicit) for `grid-row`,
`grid-column`, and `text-decoration`. Then add the missing half of the AS-069
test pair: a corpus of longhands and Webflow-acceptable properties that must
survive `parseCss` with their values intact, so that a future vocabulary bump
that starts dropping a supported property fails the suite instead of silently
stripping styles. The suite must be green before this milestone is re-submitted
for review; a red suite is an automatic FAIL.

**FU-M2-22 — Source the shorthand vocabulary from a complete, maintained
dataset (blocker, AS-069).** The `css-shorthand-properties` package carries 43
entries and predates CSS logical properties, so `overscroll-behavior`,
`border-inline-start`, `border-inline-end`, `border-block-start`,
`border-block-end`, `contain-intrinsic-size`, `font-synthesis`,
`animation-range`, `scroll-timeline`, `view-timeline`, `grid-template-areas`
and `-webkit-box-shadow` still reach the payload verbatim with no warning —
all ten of the first group were named explicitly in round 3's FU-M2-14 and
none were fixed. Replace or supplement the package with `mdn-data`'s
`css/properties.json`, which encodes the shorthand/longhand relationship for
the full property set and is updated with the specs, and derive the audit
corpus from that same dataset so the suite fails the moment the implementation
and the reference diverge. Keep the vendor-prefix stripping, which works.
Record the dataset version and the date it was checked in.

**FU-M2-23 — No expander may emit a non-string or empty value, enforced
suite-wide (major).** FU-M2-16 was implemented as seven targeted guards;
`gap`, `overflow`, `place-items`/`place-content`/`place-self` and `flex` were
missed and still return `undefined`-valued keys for an empty value, while
`transition` returns four empty strings. Add the guard to the remaining
expanders with a warning naming the property, and — the part that actually
prevents recurrence — add a single test that parses a stylesheet exercising
every shorthand with empty, whitespace-only and comment-only values, walks
every `base` and every variant bucket of the result, and fails if any value is
not a non-empty string. Targeted guards will keep being missed until the
invariant is asserted over the whole payload.

**FU-M2-24 — Unknown tokens must never overwrite a resolved longhand (major,
AS-062/AS-066).** FU-M2-17 named `transition`, `flex-flow` and `list-style`;
only `transition` was fixed. `flex-flow: wrap row extra` still reports
`flex-direction: extra`, and `list-style: disc foo bar` still reports
`list-style-type: bar`, destroying the valid `disc` it had already parsed.
Route both through the same "unrecognized token skipped" warning helper
`expandTransition` now uses: an unmatched token leaves the already-set longhand
alone and produces a warning. Extend the same rule to `parseBorderParts`
(`border: 1px solid red blue` silently discards `blue`), to the box rule when
more than four values are supplied, and to `gap`'s and `place-*`'s extra
values. Add a test per case asserting both the preserved longhand and the
presence of the warning.

---

**FU-M2-25 — `mapBreakpoint` must reject every media feature it does not
model, and nested `@media` must not silently pick the inner bound (major,
AS-048).** The condition parser added in F061 rejects comma lists, `not`,
`only`, and min+max compounds, but anything else in an `and` chain is ignored:
`print and (max-width:767px)` maps to `small`, `tv and (max-width:479px)` to
`tiny`, and `(max-width:767px) and (orientation:landscape)` to `small`, all
without a warning — so a print-only or orientation-only stylesheet is promoted
into a real Webflow breakpoint. AS-048 names `print` as its example and only
the bare form is caught. Invert the parser's default: split the condition into
its terms, and unless *every* term is either a recognised media type of
`screen`/`all` or a width bound that maps exactly, return null with a warning
naming the unhandled term. Resolve same-axis compounds by intersection rather
than first-listed (`(max-width:991px) and (max-width:767px)` currently yields
`medium`). Separately, `walk()` recurses into a nested `@media` with the inner
breakpoint and discards the outer, so
`@media (max-width:767px){@media (max-width:991px){...}}` lands on tablet;
either intersect the two bounds or warn and skip. Add a case per media feature.

**FU-M2-26 — Correct the nine remaining test mislabels and replace the
grep-based coverage audit (major, AS-135).** Round 3's AS-051/AS-052 mislabels
were removed but the defect reappeared elsewhere: `css.test.ts:132,139,144,149,154`
are named `test_AS_057_*` and test nested rules and unknown at-rules, never
`border-radius` corner order; `css.test.ts:170,181` claim AS-039 while testing
combo-to-base linkage, which is AS-040's subject; `breakpoints.test.ts:74,78`
claim AS-048 while asserting positive `small` mappings, which is AS-071's. A
grep audit therefore reports eight AS-057 tests where three exist. Correct the
labels, and — as round 3's FU-M2-20 already asked — replace the ID-presence
audit with a checked-in `assertion-ID → test-name → verbatim-assertion-text`
mapping, so coverage is claimed only where someone has matched the test's
subject to the assertion's words. Two rounds of label-by-label correction have
now produced two rounds of new mislabels; the audit mechanism is the thing that
needs replacing.

**FU-M2-27 — `parseBorderParts` must accept more than one token per role, and
`expandFont` must warn instead of guessing (major, AS-055/AS-065).**
`parseBorderParts` assigns the first width-like, style-like and colour-like
token and silently discards everything after, so `border: 1px 2px solid red`
reports `border-*-color: 2px` and loses `red`, and
`border: var(--w) var(--s) var(--c)` — three opaque `var()` tokens, the pattern
this repo's own design-system CSS uses — produces only
`border-*-color: var(--w)` with no width and no style on any side. Assign
`var()` tokens positionally in width/style/colour order when the whole value is
`var()`s, and warn on any token that cannot be placed. In `expandFont`, add
`font-stretch` keywords (`condensed`, `expanded`, …) and angled `oblique
<angle>` to the vocabulary, and make the fallback warn-and-drop rather than
assigning an unrecognised leading token to `font-size`:
`font: condensed 16px Arial` currently yields `font-size: "condensed"` and
`font-family: "16px Arial"` in silence.

---

## Command output

### `npx vitest run lib/webflow-converter/`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ❯ lib/webflow-converter/css.test.ts (49 tests | 1 failed) 19ms
     × AS-076: other background-* longhand properties on the same class are unaffected by the presence of background-image 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  lib/webflow-converter/css.test.ts > F014 parseCss > AS-076: other background-* longhand properties on the same class are unaffected by the presence of background-image
AssertionError: expected undefined to be 'center' // Object.is equality

- Expected:
"center"

+ Received:
undefined

 ❯ lib/webflow-converter/css.test.ts:298:46
    296|     expect(hero.base["background-image"]).toBe('url("/img/hero.jpg")');
    297|     expect(hero.base["background-color"]).toBe("red");
    298|     expect(hero.base["background-position"]).toBe("center");
       |                                              ^
    299|     expect(hero.base["background-size"]).toBe("cover");
    300|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 201 passed (202)
   Duration  313ms
```

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

### Independent probes (tsx, against the shipped modules at fcf82ae3)

**Round-3 fixes confirmed**
```
border: 0                 -> {border-top-width:"0", border-right-width:"0", border-bottom-width:"0", border-left-width:"0"}
outline: 0                -> {outline-width:"0"}
border: 0 solid red       -> width/style/color correct on all four sides
outline: 2px auto -webkit-focus-ring-color
                          -> {outline-width:"2px", outline-style:"auto", outline-color:"-webkit-focus-ring-color"}
transition: opacity .2s var(--ease)
                          -> {transition-property:"opacity", transition-duration:".2s", ...}
                             + warning 'transition: unrecognized token "var(--ease)" skipped'
font: 16px / 1.5 Arial    -> {font-size:"16px", line-height:"1.5", font-family:"Arial"}
font: 1000 14px Inter     -> {font-weight:"1000", font-size:"14px", font-family:"Inter"}
font: small-caps bold 14px Arial -> {font-variant:"small-caps", font-weight:"bold", font-size:"14px", font-family:"Arial"}
font: caption             -> {} + "font: system-font keyword 'caption' not supported"

mapBreakpoint('(min-width:768px) and (max-width:991px)') -> null
mapBreakpoint('not all and (max-width:767px)')           -> null
mapBreakpoint('only screen and (max-width:767px)')       -> null
mapBreakpoint('(max-width:767px),(max-width:479px)')     -> null
mapBreakpoint('(width <= 767px)')                        -> "small"
@media (max-width:800px){.a{color:red}} -> [] + "@media ((max-width:800px)) does not map to a Webflow breakpoint — skipped"

-webkit-transition / -webkit-animation / -webkit-border-radius / -ms-flex /
-o-transition / -webkit-flex-flow / -webkit-text-decoration / -webkit-columns
                          -> {} + "shorthand '<p>' is not supported — write longhands instead"

grep 'AS-051\|AS-052' lib/webflow-converter/*.test.ts -> (no matches)
```

**NB2 — AS-076 regression**
```
parseCss('.hero{background-image:url("/a.png");background-position:50% 50%;background-color:red}')
 base     = {"background-image":"url(\"/a.png\")","background-color":"red"}
 warnings = [".hero: shorthand 'background-position' is not supported — write longhands instead"]

parseCss('.x{background-position:center;color:red}')
 base     = {"color":"red"}
 warnings = [".x: shorthand 'background-position' is not supported — write longhands instead"]

Vocabulary size: 43
Warn-and-dropped by the package: background, background-position, border-image,
font-variant, grid, grid-template, grid-row, grid-column, grid-area, mask,
mask-border, columns, column-rule, scroll-padding, scroll-padding-block,
scroll-padding-inline, scroll-snap-margin, scroll-snap-margin-block,
scroll-snap-margin-inline, cue, pause, rest, text-decoration, text-emphasis,
animation
```

**NB3 — AS-069 leaks that remain**
```
overscroll-behavior          isShorthand=false  {"decls":{"overscroll-behavior":"foo bar"}}
overscroll-behavior-inline   false              {"decls":{"overscroll-behavior-inline":"foo bar"}}
border-inline-start          false              {"decls":{"border-inline-start":"foo bar"}}
border-inline-end            false              {"decls":{"border-inline-end":"foo bar"}}
border-block-start           false              {"decls":{"border-block-start":"foo bar"}}
border-block-end             false              {"decls":{"border-block-end":"foo bar"}}
contain-intrinsic-size       false              {"decls":{"contain-intrinsic-size":"foo bar"}}
font-synthesis               false              {"decls":{"font-synthesis":"foo bar"}}
animation-range              false              {"decls":{"animation-range":"foo bar"}}
scroll-timeline              false              {"decls":{"scroll-timeline":"foo bar"}}
view-timeline                false              {"decls":{"view-timeline":"foo bar"}}
grid-template-areas          false              {"decls":{"grid-template-areas":"foo bar"}}
-webkit-box-shadow           false              {"decls":{"-webkit-box-shadow":"foo bar"}}

parseCss('.x{overscroll-behavior:contain none}')
 -> base {"overscroll-behavior":"contain none"}, warnings []
@media (max-width:479px){.y:hover{overscroll-behavior:contain}}
 -> y.variants.tiny_hover = {"overscroll-behavior":"contain"}, warnings []

In vocabulary? overscroll-behavior:false border-inline-start:false
border-block-end:false contain-intrinsic-size:false font-synthesis:false
animation-range:false scroll-timeline:false view-timeline:false
```

**Majors re-confirmed / newly found**
```
parseCss('.a{transition:;margin: ;padding:;gap:;overflow: }') base entries =
  [["transition-property",""],["transition-duration",""],
   ["transition-timing-function",""],["transition-delay",""],
   ["row-gap",undefined],["column-gap",undefined],
   ["overflow-x",undefined],["overflow-y",undefined]]
  warnings = []
  -> 8 of 8 emitted values are non-string or empty

flex-flow: wrap row extra    -> {"flex-wrap":"wrap","flex-direction":"extra"}   no warning
list-style: disc foo bar     -> {"list-style-type":"bar"}                        no warning
border: 1px solid red blue   -> "blue" discarded                                 no warning
margin: 1px 2px 3px 4px 5px  -> 1/2/3/4, "5px" discarded                         no warning
gap: 1px 2px 3px             -> {"row-gap":"1px","column-gap":"2px"}             no warning
mapBreakpoint('(max-width:0991px)') -> "medium"
```

**Reviewer findings independently re-probed**
```
mapBreakpoint('print and (max-width:767px)')                   -> "small"
mapBreakpoint('(max-width:767px) and (orientation:landscape)') -> "small"
mapBreakpoint('tv and (max-width:479px)')                      -> "tiny"
mapBreakpoint('(max-width:991px) and (max-width:767px)')       -> "medium"
mapBreakpoint('(min-width:1440px) and (min-width:1920px)')     -> "large"
mapBreakpoint('(width >= 1440px)')                             -> null

parseCss('@media (max-width:767px){@media (max-width:991px){.c{color:red}}}')
 -> c.variants = {"medium":{"color":"red"}}   warnings []

border: 1px 2px solid red -> border-*-width "1px", border-*-style "solid",
                             border-*-color "2px"      ("red" gone, no warning)
border: var(--w) var(--s) var(--c)
                          -> border-*-color "var(--w)" only  (no width, no style)
font: condensed 16px Arial -> {"font-size":"condensed","font-family":"16px Arial"}
flex: none extra           -> {"flex-grow":"none","flex-shrink":"1","flex-basis":"extra"}
.card{margin:inherit !important} -> warnings [
   '.card: dropped "margin: inherit" — global keyword on a shorthand',
   '.card: "!important" on margin was dropped' ]
```

**Mislabel sweep**
```
css.test.ts:132  test_AS_057_nested_rule_warns_and_does_not_clobber_parent_decls
css.test.ts:139  test_AS_057_nested_atrule_warns_instead_of_silent_loss
css.test.ts:144  test_AS_057_unknown_top_level_atrule_container_warns
css.test.ts:149  test_AS_057_unknown_top_level_atrule_page_warns
css.test.ts:154  test_AS_057_unknown_top_level_atrule_import_warns
        -> none touch border-radius or corner order (AS-057's subject)
css.test.ts:170  "AS-039: a standalone class and its later combo use ..."
css.test.ts:181  "AS-039: combo-then-standalone is order-independent ..."
        -> both test combo-to-base linkage = AS-040's subject
breakpoints.test.ts:74  "AS-048: (width <= 767px) range syntax maps to 'small'"
breakpoints.test.ts:78  "AS-048: (width < 768px) range syntax maps to 'small'"
        -> positive mappings = AS-071's subject, not AS-048's
grep 'AS-051\|AS-052' lib/webflow-converter/*.test.ts -> (no matches)  [round-3 mislabels fixed]
```

**Selector / breakpoint side re-verified**
```
.card{color:red}              -> card base {color:red}
.card.is-featured{color:gold} -> card{}, is-featured{}, card|is-featured{color:gold} comboOf ["card"]
.b:hover/:focus-visible/::placeholder/::before/:visited/:active
                              -> main_hover / main_focus-visible / main_placeholder /
                                 main_before / main_visited / main_pressed
.card h3 / #hero / a.btn > span / [data-x]  -> [] + non-plain-selector warning
.a{color:red !important}      -> {color:red} + '.a: "!important" on color was dropped'
@keyframes spin{...}          -> [] + '@keyframes "spin" cannot be pasted — move it to page custom code'
@font-face{...}               -> [] + '@font-face cannot be pasted — upload the font in Webflow site settings'
@media (max-width:991px){.card:hover{...}} -> variants.medium_hover
.a{background-image:url("/i.jpg")}  -> byte-identical, quotes intact
.x::hover{color:red}          -> accepted as main_hover                          (minor)
@supports (display:grid){.a{color:red}} -> applied unconditionally, warnings []   (minor)
.w-1\/2{width:50%}            -> [] + generic non-plain-selector warning          (minor)
```
