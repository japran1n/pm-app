# M2 scrutiny — round 3 — Conversion engine: CSS (F005–F014, F051–F058)

_Mission 20260917-170249 · 2026-09-17 · read-only adversarial re-review_

## VERDICT: **FAIL** — 1 blocker, 7 majors

Two of the three round-2 blockers (NB2, NB3) are genuinely fixed — verified by
probe, not by reading commits. **NB1 (AS-069) is not fixed.** It was patched at
the instance level for the 21 property names the round-2 report happened to
list, and the new "independent corpus" test is not independent: it asserts
`isShorthand(prop) === true` for the same 21 strings that were just added to
`SHORTHANDS`, and the parseCss-level test asserts the output against
`isShorthand` — the very predicate that decided what to expand. Both tests are
structurally incapable of failing for a shorthand the set omits, which is the
exact defect they exist to catch. Real shorthands still reach the payload
verbatim with zero warnings.

Suite 187/187 green, `tsc --noEmit` clean (exit 0), `eslint` clean. Green
remains not evidence.

## Round-2 blockers: re-verified by probe

| Was | Now | Probe evidence |
|---|---|---|
| NB1 / AS-069 | **NOT FIXED** | See B1. `.x{column-rule:1px solid red; overscroll-behavior:contain; font-variant:small-caps; -webkit-transition:all .2s ease; border-inline-start:1px solid red; mask-border:url(x.png) 30}` → all six land in `base` verbatim, `warnings: []`. Also reproduces inside `tiny_hover`. |
| NB2 / AS-057 throws | **FIXED** | `.a{border-radius: ;}` → `{}` + `".a: border-radius: empty value skipped"`. `/**/` same. `.a{border-radius: / 4px}` → `{}` + leading-slash warning (no longer writes vertical radii into all corners). `.card { color: red;` → `{classes:[], warnings:["CSS parse error: Unclosed block"]}` — no throw. Per-declaration try/catch at `css.ts:181` contains any future internal throw as a warning. |
| NB3 / at-rules | **FIXED** | `.a{color:red; @media(max-width:767px){color:blue}}` → base preserved + `"nested @media in .a: not supported — declarations skipped"`. `@container` → `"@container is not supported — 1 rule(s) skipped"`; `@page`, `@import`, `@property` likewise. No at-rule kind now disappears without a signal. |

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-039 | PASS | — | `.card` → one class definition; chain identity keeps standalone and combo distinct. |
| AS-040 | PASS | — | `comboOf: string[]`; `.a.b.c` → `["a","b"]`; order-independent. |
| AS-041 | PASS | minor | All 8 states map, `:active`→`pressed`, `:hover:focus` rejected. `.x::hover` still accepted. |
| AS-042 | PASS | — | Descendant → warning, 0 classes. |
| AS-043 | PASS | — | ID → warning, 0 classes. |
| AS-044 | PASS | — | `>` and `+` → warning, 0 classes. |
| AS-045 | PASS | — | Attribute → warning, 0 classes. |
| AS-046 | PASS | minor | Flag dropped, decl applied, one warning. Only tested on `color`. |
| AS-047 | N/A | — | HTML-side (M3). |
| AS-048 | **FAIL** | major | `mapBreakpoint('(min-width:768px) and (max-width:991px)')` → `medium`; a tablet-only rule is applied to every smaller breakpoint by Webflow's cascade. `@media not all and (max-width:767px)` → `small`. Both silent, zero warnings, untested. Range syntax (`(width <= 767px)`) unrecognised. |
| AS-049 | PASS | — | Warns "page custom code", no style. |
| AS-050 | PASS | — | Warns "Webflow site settings", no style. |
| AS-051 | **FAIL** | major | HTML-side (M3), legitimately unimplemented — but `css.test.ts:124` and `:131` are still *labelled* AS-051 while testing breakpoint variant keys. AS-051 reads as covered and is not. |
| AS-052 | **FAIL** | major | Same: `css.test.ts:171` labelled AS-052, actually a combo-class test. |
| AS-053 | PASS | major | 1/2/3/4 correct, `var()`/`calc()` preserved. `margin: ;` returns four keys whose **values are `undefined`**; `toEqual({})` passes vacuously because vitest treats an `undefined` value as absent. `>4` values silently truncated. |
| AS-054 | PASS | major | Same path, same defects. |
| AS-055 | **FAIL** | major | `border: 0` — the most common reset idiom in CSS — yields `border-*-color: "0"` on all four sides and **no width at all**, because `isWidth` demands a unit suffix so bare `0` falls into the colour slot. Invalid output, silent, untested. `border: 1px solid red blue` still discards `blue` silently. |
| AS-056 | PASS | — | Only the named side's three longhands; all four verified. |
| AS-057 | PASS | — | 1–4 values in TL/TR/BR/BL order; `calc(100%/2)` not split; elliptical warns; empty/leading-slash guarded. Round-2 blocker resolved. |
| AS-058 | PASS | major | 1→both, 2→row/column, `grid-gap` aliased. Empty value → `undefined`-valued keys (same defect as AS-053). Third value silently dropped. |
| AS-059 | PASS | major | 1→both, 2→x/y. Third value silently dropped. |
| AS-060 | PASS | major | All three pairs correct; extras silently dropped. |
| AS-061 | PASS | — | `none`/`auto`/number/2-value/3-value/calc-basis all spec-correct. `initial` dropped by the AS-068 guard — contract-conformant. |
| AS-062 | PASS | major | Order-independent, but any non-wrap token becomes `flex-direction`, last wins: `flex-flow: wrap row extra` → `flex-direction: extra`, no warning. |
| AS-063 | **FAIL** | major | `transition: opacity .2s var(--ease)` → `transition-property: "var(--ease)"`. A tokenised easing variable — the normal pattern in this repo's own design-system CSS — **destroys the animated property**, silently. The assertion requires the four longhands to carry the item's property; they do not. |
| AS-064 | PASS | — | Paren-aware comma split; positional alignment verified for 2 and 3 items; `cubic-bezier`/`steps` survive. |
| AS-065 | **FAIL** | major | `font: 16px / 1.5 Arial` (valid CSS) → `{font-size:"16px", font-family:"/ 1.5 Arial"}` — no `line-height`, garbage family, no warning. `font: 1000 14px Inter` → `font-size:"1000"`, `font-family:"14px Inter"` (CSS4 allows weight 1000; the regex caps at 3 digits, and the 450/350/550 regression test stops short of the boundary). `small-caps` consumed and discarded. `font: caption` → `font-size: caption`. |
| AS-066 | PASS | major | type/position/image routed; unknown tokens last-wins into `list-style-type`, no warning. |
| AS-067 | **FAIL** | major | `outline: 2px auto -webkit-focus-ring-color` → `{outline-width:"2px", outline-color:"auto"}`: style lost, real colour discarded. `outline: 0` → `{outline-color:"0"}` (same unitless-zero defect as AS-055). Assertion requires width+style+color. |
| AS-068 | PASS | — | Case-insensitive, gated on `isShorthand`, covers `revert-layer`, `{}` + warning. |
| AS-069 | **FAIL** | **blocker** | See B1. |
| AS-070/071/072 | PASS | — | 991→medium, 767→small, 479→tiny; exact-match, no snapping. |
| AS-073 | PASS | — | 1440/1920/2560 → large/xl/xxl. |
| AS-074 | PASS | — | No media query → base; `variantKey('main', null)` → null. |
| AS-075 | PASS | — | `url("/img/hero.jpg")` byte-identical, quotes intact. |
| AS-076 | PASS | — | `background-color`/`-position`/`-size` coexist with `background-image` untouched. |
| AS-135 | **FAIL** | major | Three mislabels persist (`css.test.ts:124`, `:131` → AS-051; `:171` → AS-052), so a grep-based coverage audit returns a false pass for two assertions with no test. |

---

## Blocker

### B1 — AS-069: the whitelist is still the only defence, and its two tests cannot fail

`expandDeclaration`'s `default:` branch (`longhand.ts:348-352`) reads
"not in `SHORTHANDS` ⇒ it is a longhand ⇒ emit verbatim". F057 added 21 names
to the set. The property *class* is unchanged: anything the set omits still
reaches the payload.

```
parseCss('.x{ column-rule:1px solid red; overscroll-behavior:contain none;
              font-variant:small-caps common-ligatures;
              -webkit-transition:all .2s ease;
              border-inline-start:1px solid red; mask-border:url(x.png) 30 }')
base     = { 'column-rule':'1px solid red', 'overscroll-behavior':'contain none',
             'font-variant':'small-caps common-ligatures',
             '-webkit-transition':'all .2s ease',
             'border-inline-start':'1px solid red', 'mask-border':'url(x.png) 30' }
warnings = []
```

Also reproduces in a breakpoint+state bucket:
```
@media (max-width:479px){ .y:hover{ column-rule:1px solid red } }
 -> y.variants.tiny_hover = { 'column-rule':'1px solid red' }
```

Still missing from `SHORTHANDS`: `column-rule`, `font-variant`,
`font-synthesis`, `overscroll-behavior`, `mask-border`, `scroll-snap-margin`,
`border-block-start`, `border-block-end`, `border-inline-start`,
`border-inline-end`, `contain-intrinsic-size`, `animation-range`,
`scroll-timeline`, `view-timeline`, `cue`, `marker`, and **every
vendor-prefixed shorthand** (`-webkit-transition`, `-webkit-animation`,
`-webkit-border-radius`, `-moz-*`). Vendor-prefixed shorthands are the highest
real-world risk: any autoprefixed or copied-from-production stylesheet carries
them, and Webflow rejects shorthand declarations outright, so the paste fails
or silently loses styling with nothing in the warnings list.

**The two new tests cannot catch this, today or ever:**

- `longhand.test.ts:973` — `test_AS_069_shorthand_vocabulary_whitelist_recognizes_all_missing_properties`.
  Its comment claims independence ("NOT derived from SHORTHANDS"), but every
  one of its 21 entries is a transcription of an entry added to `SHORTHANDS` in
  the same commit. It detects *removal* from the set. It cannot detect
  *omission* from the set, which is the entire defect.
- `longhand.test.ts:1028` — `test_AS_069_parseCss_never_surfaces_a_shorthand_key_in_base_or_variant_buckets`.
  It asserts `isShorthand(key) === false` over the output. `isShorthand` is the
  same predicate that decided which properties to expand, so the assertion is a
  tautology: any property the set omits is expanded-not, emitted verbatim, and
  then certified "not a shorthand" by the same lookup. It is structurally
  incapable of failing.

This is the third round in which AS-069 has been closed against a named list
rather than against an independent vocabulary. Round 2's recommendation
(FU-M2-7) specified deriving the vocabulary from an independent source and
sourcing the test corpus from it; that instruction was not carried out.

---

## Majors

- **M-a — AS-063 `transition` easing variables destroy `transition-property`.**
  `transition: opacity .2s var(--ease)` → `transition-property: var(--ease)`.
  New finding this round; the repo's own design-system CSS uses this pattern.
- **M-b — AS-055/AS-067 unitless zero is classified as a colour.** `border: 0`
  → `border-*-color: "0"`, width lost; `outline: 0` → `outline-color: "0"`.
  `isWidth` requires a unit suffix. New finding this round. `border: 0` is a
  reset idiom present in essentially every real stylesheet.
- **M-c — Empty box-shorthand values emit keys with `undefined` values.**
  `margin: ;` / `padding:;` / `gap:` produce
  `{margin-top: undefined, ...}`. The tests assert `toEqual({})`, which passes
  vacuously because vitest ignores `undefined`-valued keys, and `JSON.stringify`
  hides them too. Latent: the first serializer that walks `Object.entries` will
  emit `margin-top: undefined` into a payload. Only `border-radius` guards this.
- **M-d — AS-048 compound/negated media queries silently mis-map.**
  `(min-width:768px) and (max-width:991px)` → `medium` (cascades down to
  mobile in Webflow); `not all and (max-width:767px)` → `small`. Range syntax
  unrecognised. `breakpoints.test.ts` only feeds single-condition strings.
- **M-e — AS-065 `font` defects:** spaced slash, weight `1000`, `small-caps`,
  system-font keywords.
- **M-f — AS-067 `outline-style: auto`** unsupported, losing the style on the
  standard focus-ring idiom.
- **M-g — AS-135 mislabels persist.** `css.test.ts:124`/`:131` claim AS-051,
  `:171` claims AS-052. Both assertions are HTML-side and correctly have no
  implementation yet — but the labels make the F039 coverage audit report them
  as covered.

## Minors

- `.x::hover` (invalid double-colon) accepted as hover.
- `@supports` and `@layer` are transparently unwrapped with no warning —
  conditionally-applied styles become unconditional. (`@layer` at least has a
  cascade-order rationale; `@supports` does not.)
- Pervasive silent token loss remains: box `>4` values, `parseBorderParts`
  leftovers, `gap`/`overflow` third values, `place-*` extras, `list-style` and
  `flex-flow` unknown tokens (the latter clobbering `flex-direction`).
- `isWidth` still matches `1.2.3px`.
- `max-width: 0991px` maps to `medium` via `parseFloat`.
- Empty variant buckets: a media block whose declarations are all dropped still
  creates `variants: {small: {}}`.
- Tailwind-escaped class names (`.w-1\/2`) rejected with the generic warning;
  nothing pins this either way.

## Behaviour changes no current test would catch

- Adding a property to `SHORTHANDS`, or omitting one (both AS-069 tests are
  closed over the set).
- `border: 0` / `outline: 0` classification.
- Empty-value handling for `margin`/`padding`/`inset`/`gap`/`overflow`/`place-*`.
- The `>4`-value truncation rule; `box()`'s 3-value rule.
- `expandTransition`'s treatment of an unrecognised token.
- Any change to `expandFont`'s slash, weight bound, `small-caps`, or
  system-keyword handling.
- Swapping `min-width`/`max-width` precedence for compound queries.
- Regressing last-wins declaration order to first-wins.

---

## Recommended follow-up features

**FU-M2-14 — AS-069 must be enforced against a vocabulary the module does not
own (blocker).** The `SHORTHANDS` literal cannot be both the expansion
dispatch table and the audit oracle; while it is both, every AS-069 test is a
tautology and every omission is invisible. Introduce a second, independently
sourced shorthand vocabulary — a maintained package such as
`css-shorthand-properties`, or a checked-in list generated from the CSS specs
and annotated with its provenance and generation date — and make
`expandDeclaration`'s `default:` branch warn-and-drop any property that
vocabulary recognises. Normalise vendor prefixes (`-webkit-`, `-moz-`, `-ms-`,
`-o-`) before the lookup so `-webkit-transition` is caught as `transition`.
Then rewrite both AS-069 tests so their corpus comes from the independent
vocabulary and never from `SHORTHANDS`: the suite must fail the moment the two
diverge. Delete
`test_AS_069_parseCss_never_surfaces_a_shorthand_key_in_base_or_variant_buckets`
in its current form — asserting `isShorthand(key) === false` over output the
same predicate produced proves nothing. At minimum the set must gain
`column-rule`, `font-variant`, `font-synthesis`, `overscroll-behavior`,
`mask-border`, `scroll-snap-margin`, `border-block-start`, `border-block-end`,
`border-inline-start`, `border-inline-end`, `contain-intrinsic-size`,
`animation-range`, `scroll-timeline`, `view-timeline`.

**FU-M2-15 — Value-classification bugs in `parseBorderParts` (major).**
Treat a unitless `0` as a width so `border: 0` and `outline: 0` produce
`border-*-width: 0` / `outline-width: 0` instead of putting `0` in the colour
slot and losing the width entirely; `border: 0` is present in essentially every
real-world reset. Add `auto` to the outline style vocabulary so
`outline: 2px auto -webkit-focus-ring-color` yields width+style+color. Warn on
any token `parseBorderParts` cannot place (`border: 1px solid red blue`
currently discards `blue` in silence). Add tests for `border: 0`,
`border: 0 solid red`, `outline: 0`, and the focus-ring idiom.

**FU-M2-16 — No expander may emit an `undefined` value (major).**
`box()` returns `undefined`s for a short or empty part list and
`Object.fromEntries` faithfully creates keys holding them; the existing
"empty value" tests assert `toEqual({})` and pass vacuously because vitest
ignores `undefined`-valued keys. Guard every shorthand expander against an
empty or whitespace/comment-only value the way `expandBorderRadius` now does —
return `{decls:{}}` plus a warning naming the property — and add a suite-wide
test that walks every bucket of a parsed payload and fails if any value is not
a non-empty string. Replace the vacuous `toEqual({})` assertions with explicit
`Object.keys(decls)).toHaveLength(0)` checks.

**FU-M2-17 — `transition` and `flex-flow` must not let an unknown token
overwrite a real longhand (major).** In `expandTransition`, the catch-all
`else` assigns any unmatched token to `transition-property`, so
`transition: opacity .2s var(--ease)` silently reports `var(--ease)` as the
animated property. Recognise `var()` and any unknown token as
"unclassifiable": leave the already-set longhand alone and emit a warning
naming the discarded token. Apply the same rule to `flex-flow`, where a stray
token currently overwrites `flex-direction`, and to `list-style`, where it
overwrites `list-style-type`. Route all of these through a single
"discarded value" warning helper so a conversion is either faithful or noisy,
never quietly lossy.

**FU-M2-18 — Media-query condition parsing (major, AS-048).** Replace the
first-match regex scrape in `mapBreakpoint` with a real parse of the media
condition: reject with a warning any query carrying `not` or `only`, and any
query combining a `min-width` with a `max-width`, rather than snapping to
whichever bound the regex finds first. `@media (min-width:768px) and
(max-width:991px)` currently becomes Webflow's `medium` variant, which cascades
down to mobile — the tablet-only intent is inverted. Add cases for negation,
`only screen`, compound `and`, comma-separated query lists, and range syntax
(`(width <= 767px)`), which the current regex does not recognise at all.
Reject a zero-padded value like `0991px` rather than `parseFloat`-ing it.

**FU-M2-19 — `font` shorthand vocabulary gaps (major, AS-065).** Normalise
whitespace around the size/line-height slash before the `includes('/')` check
so `font: 16px / 1.5 Arial` parses identically to `font: 16px/1.5 Arial`;
today it yields a garbage `font-family` of `"/ 1.5 Arial"` and no
`line-height`. Extend the weight regex to accept `1000` (CSS4's upper bound —
the existing 450/350/550 regression test stops one value short). Emit
`font-variant: small-caps` rather than consuming and discarding the token. Warn
on system-font keywords (`caption`, `menu`, `status-bar`) instead of assigning
them to `font-size`.

**FU-M2-20 — Verify test labels against assertion subjects (major, AS-135).**
Three mislabels survive two rounds of correction and are worse than missing
labels, because they make the grep-based F039 coverage audit return a false
pass: `css.test.ts:124` and `:131` claim AS-051 while testing breakpoint
variant keys, and `:171` claims AS-052 while testing combo classes. AS-051 and
AS-052 are HTML-side assertions that legitimately have no implementation until
M3 — they must read as *uncovered* until then. Correct the three labels, and
replace the ID-presence audit with one that records a reviewed
assertion-ID → test-name → verbatim-assertion-text mapping in a checked-in
file, so coverage is claimed only where a human or reviewer has matched the
test's subject to the assertion's words.

---

## Command output

### `npx vitest run lib/webflow-converter/`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  187 passed (187)
   Start at  19:51:44
   Duration  302ms (transform 210ms, setup 420ms, import 194ms, tests 31ms)
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

### Independent probes (tsx, against the shipped modules)

**Round-2 blockers NB2/NB3 — confirmed fixed**
```
.a{border-radius: ;}    -> base {}  warn ['.a: border-radius: empty value skipped']
.a{border-radius:/**/;} -> base {}  warn ['.a: border-radius: empty value skipped']
.card { color: red;     -> classes [] warn ['CSS parse error: Unclosed block']   (no throw)
.a{border-radius: / 4px}     -> base {} warn ['.a: border-radius: leading-slash form not supported — values skipped']
.a{border-radius: 10px / 20px} -> four corners 10px + elliptical warning
.a{border-radius: calc(100%/2)} -> four corners calc(100%/2), no warning

.a{color:red; @media (max-width:767px){color:blue}}
  -> base {color:red}  warn ['nested @media in .a: not supported — declarations skipped']
@container (max-width:500px){.a{color:red}} -> [] warn ['@container is not supported — 1 rule(s) skipped']
@page{margin:1cm}          -> [] warn ['@page is not supported — 0 rule(s) skipped']
@import url(x.css);        -> [] warn ['@import is not supported — 0 rule(s) skipped']
@property --x{...}         -> [] warn ['@property is not supported — 0 rule(s) skipped']
@supports (display:grid){.a{color:red}} -> applied unconditionally, warnings []   (minor)
@layer base{.a{color:red}}              -> applied unconditionally, warnings []   (minor)
```

**B1 — AS-069 leaks persist (properties outside SHORTHANDS)**
```
NOT IN SET (emitted verbatim by expandDeclaration):
  font-variant, overscroll-behavior, mask-border, column-rule,
  border-block-start, border-block-end, border-inline-start, border-inline-end,
  -webkit-transition, -webkit-animation, -webkit-border-radius,
  animation-range, scroll-timeline, view-timeline, contain-intrinsic-size,
  font-synthesis, cue, marker

parseCss('.a{font-variant:small-caps common-ligatures; overscroll-behavior:contain none;
             -webkit-transition: all .2s ease; border-block-start: 1px solid red;
             mask-border:url(x.png) 30}')
 -> base = {"font-variant":"small-caps common-ligatures",
            "overscroll-behavior":"contain none",
            "-webkit-transition":"all .2s ease",
            "border-block-start":"1px solid red",
            "mask-border":"url(x.png) 30"}
    warnings = []

@media (max-width:479px){ .y:hover{ column-rule:1px solid red } }
 -> y.variants = { main_hover:{}, tiny_hover:{ 'column-rule':'1px solid red' } }
```

**New majors found this round**
```
border: 0                 -> {"border-top-color":"0","border-right-color":"0",
                              "border-bottom-color":"0","border-left-color":"0"}   (no width)
outline: 0                -> {"outline-color":"0"}
transition: opacity .2s var(--ease)
                          -> {"transition-property":"var(--ease)","transition-duration":".2s",
                              "transition-timing-function":"ease","transition-delay":"0s"}
font: 1000 14px Inter     -> {"font-size":"1000","font-family":"14px Inter"}
font: small-caps bold 14px Arial -> {"font-weight":"bold","font-size":"14px","font-family":"Arial"}
margin:""                 -> keys ['margin-top','margin-right','margin-bottom','margin-left']
                             values [undefined, undefined, undefined, undefined]  warning undefined
parseCss('.a{ margin: ; padding:; gap: }') base entries =
   [['margin-top',undefined],...,['row-gap',undefined],['column-gap',undefined]]  warnings []
```

**Carried-over majors re-confirmed**
```
@media not all and (max-width:767px)            -> variants.small   warnings []
mapBreakpoint('(min-width:768px) and (max-width:991px)') -> "medium"
@media (min-width:768px) and (max-width:991px){.z{color:red}} -> variants.medium, warnings []
outline: 2px auto -webkit-focus-ring-color -> {"outline-width":"2px","outline-color":"auto"}
font: 14px / 1.5 Arial    -> {"font-size":"14px","font-family":"/ 1.5 Arial"}
font: 14px/1.5 Arial      -> {"font-size":"14px","line-height":"1.5","font-family":"Arial"}
transition: opacity .2s foo bar -> transition-property "bar"
flex-flow: wrap row extra -> {"flex-wrap":"wrap","flex-direction":"extra"}
margin: 1px 2px 3px 4px 5px -> four sides 1/2/3/4, 5px dropped silently
```

**Test-label sweep**
```
css.test.ts:124  labelled AS-051 -> actually a breakpoint variant-key test
css.test.ts:131  labelled AS-051 -> actually a breakpoint variant-key test
css.test.ts:171  labelled AS-052 -> actually a combo-class test
=> AS-051 and AS-052 (both HTML-side, M3) read as covered while having no test.
```
