# M2 Scrutiny — Round 5

Mission: 20260917-170249 · Milestone M2 (Conversion engine: CSS)
Date: 2026-09-17 · Prior rounds: R1 FAIL, R2 FAIL, R3 FAIL, R4 FAIL

## Verdict: **FAIL**

Suite is 100% green (213/213), lint clean, typecheck clean. All seven
directed probes from the round-4 fix list pass. The milestone still fails
because green tests are not the bar: three independently-confirmed silent
data-corruption paths and one breakpoint regression introduced *by* the
round-4 fix are not covered by any test.

### Round-4 directed probes — all PASS

| # | Probe | Expected | Actual | Result |
|---|---|---|---|---|
| 2 | `.x{background-position:50% 50%}` | in base, no warning | `base:{background-position:'50% 50%'}`, `warnings:[]` | PASS |
| 3 | `.x{overscroll-behavior:contain}` | warning, empty base | warning emitted, `base:{}` | PASS |
| 4 | `.x{border-inline-start:1px solid red}` | warning, empty base | warning emitted, `base:{}` | PASS |
| 5 | `mapBreakpoint('print and (max-width:767px)')` | `null` | `null` | PASS |
| 6 | `.x{flex-flow:row wrap extra}` | direction/wrap + warning | `flex-direction:'row'`, `flex-wrap:'wrap'`, warning on `"extra"` | PASS |
| 7 | `.x{gap:}` | warning, no undefined | `".x: gap: empty value skipped"`, `base:{}` | PASS |

The round-4 fixes did what they claimed. The failures below are pre-existing
or newly introduced, and were found by probing beyond the directed list.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-039 | PASS | `.card` → base decl set; verified. |
| AS-040 | PASS | Combo keyed `a\|b` with `comboOf:['a']`, order-independent, 3-deep covered. |
| AS-041 | PASS | All 8 states map, incl. single-colon `:before`. (`.x::hover` wrongly accepted — minor.) |
| AS-042 | PASS | Descendant warns, `classes.size===0`. |
| AS-043 | PASS | ID selector warns, no style. |
| AS-044 | PASS | Combinator warns, no style. |
| AS-045 | PASS | Attribute selector warns, no style. |
| AS-046 | **FAIL** | `!important` warning is pushed *after* `expandDeclaration` (css.ts:182-186); if expansion throws, the required warning never fires. Assertion demands it unconditionally. **major** |
| AS-048 | **FAIL** | Inverse error: `@media screen and (max-width:991px)` — a query that *does* map — is warned and skipped. See B-1. **blocker** |
| AS-049 | PASS | `@keyframes` warns, not converted. |
| AS-050 | PASS | `@font-face` warns, not converted. |
| AS-051 | INCONCLUSIVE | No unused-class detection exists in M2 files; owned by HTML side (M3). Not verifiable here. |
| AS-052 | INCONCLUSIVE | HTML-side concern; nothing in M2 touches it. |
| AS-053 | PASS | 1/2/3/4 box rule correct. (`margin:''` silently `{}`; 5+ values truncate — minor.) |
| AS-054 | PASS | Same path as margin. |
| AS-055 | **FAIL** | `parseBorderParts` silently corrupts. Verified: `border:1px 2px solid` → `border-*-color:'2px'` (garbage, no warning); `border:var(--w) solid red` → width lost entirely, `red` vanishes, `color:'var(--w)'`. **blocker** |
| AS-056 | PASS | Per-side expansion correct; inherits AS-055's flaw. **minor** |
| AS-057 | PASS | TL/TR/BR/BL order correct; `calc()` not split. |
| AS-058 | PASS | row/column order correct, empty guarded. |
| AS-059 | PASS | x then y; single value duplicated. |
| AS-060 | PASS | All three `place-*` map correctly. |
| AS-061 | PASS | none/auto/number/length/2-val/3-val match spec resolution. |
| AS-062 | PASS | Order-independent; unknown tokens warned, non-destructive. |
| AS-063 | **FAIL** | Unparseable time silently becomes `0s`. Verified: `transition:opacity var(--d) ease` → `transition-duration:'0s'` — animation destroyed, output is wrong rather than dropped. **major** |
| AS-064 | PASS | Positional alignment holds; defaults fill missing slots. |
| AS-065 | **FAIL** | `expandFont` prelude ignores `font-stretch`. Verified: `font:condensed 14px Arial` → `font-size:'condensed'`, `font-family:'14px Arial'` — garbage, no warning. **major** |
| AS-066 | PASS | type/position/image classified; extra tokens warned. |
| AS-067 | PASS | width/style/color with `auto` style; same 3rd-token drop as border. **minor** |
| AS-068 | PASS | Guard case-insensitive, covers `revert-layer`, correctly inert on longhands. |
| AS-069 | **FAIL** | Shorthands escape verbatim into base. Verified: `white-space`, `overflow-block`, `overflow-inline`, `scroll-margin-block`, `scroll-margin-inline`. Separately `grid-column`/`grid-row` are in `SHORTHANDS` yet emitted verbatim via `PASS_THROUGH` — the module contradicts itself. **blocker** |
| AS-070 | PASS | `max-width:991px` → `medium`. Literal form only; see B-1. |
| AS-071 | PASS | `767px` → `small`. |
| AS-072 | PASS | `479px` → `tiny`. |
| AS-073 | PASS | 1440/1920/2560 → `large`/`xl`/`xxl`. |
| AS-074 | PASS | `variantKey('main', null) === null`. |
| AS-075 | PASS | `background-image:url(...)` verbatim, quotes preserved. |
| AS-076 | PASS | color/position/size unaffected alongside `background-image`. |
| AS-135 | **FAIL** | Two AS-069 corpus tests iterate `Object.keys(shorthandProperties)`; both module and test swallow a failed import into `{}`, so the loops can run zero iterations and pass green. No non-empty floor. **major** |

Totals: 26 PASS, 7 FAIL (3 blocker, 4 major), 2 INCONCLUSIVE.

## Blockers

### B-1 — `@media screen and (...)` drops the entire breakpoint (AS-048, regression from F064)

```
mapBreakpoint('screen and (max-width: 991px)')      => null
mapBreakpoint('only screen and (max-width: 767px)') => null
parseCss('@media screen and (max-width:991px){.a{color:red}}')
  => classes: Map(0) {}, warnings: ['@media (screen and (max-width:991px)) does not map to a Webflow breakpoint — skipped']
```

F064 rejected media-type-prefixed queries to make `print` return null. It
over-corrected: `screen` and `only screen` are the form **Webflow's own CSS
export emits** and the dominant hand-authored form. Every tablet/mobile block
in a real stylesheet silently becomes a warning. Worse, `breakpoints.test.ts:47`
asserts this behaviour (`expect(mapBreakpoint('screen and (max-width:991px)')).toBeNull()`),
so the test suite now locks the bug in. `screen`/`only screen`/`all` must be
stripped and the width honoured; `print`/`tv`/`speech` must stay rejected.

### B-2 — `border` / `outline` shorthand silently emits garbage (AS-055)

```
expandDeclaration('border','1px 2px solid')
  => border-*-width:'1px', border-*-style:'solid', border-*-color:'2px'   (no warning)
expandDeclaration('border','var(--w) solid red')
  => border-*-style:'solid', border-*-color:'var(--w)'                     (width lost, 'red' vanished)
```

`parseBorderParts` fills slots positionally and discards unclassified tokens
without warning. `var()` in a border shorthand is routine in token-driven CSS.
Output is confidently wrong with zero operator signal.

### B-3 — Shorthands still reach the payload verbatim (AS-069)

```
expandDeclaration('white-space','nowrap')        => { 'white-space': 'nowrap' }
expandDeclaration('overflow-block','hidden')     => { 'overflow-block': 'hidden' }
expandDeclaration('overflow-inline','auto')      => { 'overflow-inline': 'auto' }
expandDeclaration('scroll-margin-block','4px')   => { 'scroll-margin-block': '4px' }
expandDeclaration('grid-column','1 / 3')         => { 'grid-column': '1 / 3' }   // isShorthand('grid-column') === true
```

AS-069 admits no exceptions. `grid-column`/`grid-row`/`grid-area` appear in
BOTH `SHORTHANDS` (longhand.ts:182) and `PASS_THROUGH` (longhand.ts:258).
`grid-area` is saved only because an earlier `switch` case catches it first —
making its `PASS_THROUGH` entry dead code and proving the allow-list was not
reasoned against the shorthand vocabulary. The four remaining round-4 patches
were additive patches to a blacklist; the assertion requires a whitelist.

## Additional defects (non-blocking)

- `grid-template-areas` is a **longhand** of `grid-template` but sits in
  `EXTRA_SHORTHANDS`; it is warned-and-dropped. A valid property is removed. (minor)
- `parseCss('@media (max-width:991px){ color:red }')` → `{}` with **zero**
  warnings. `walk` has no else-branch for non-rule/non-atrule nodes. (minor)
- Nested `@media` silently discards the outer query; innermost wins, user never told. (minor)
- `.-mt-2` and `.w-1\/2` are rejected as "not a plain class selector". Leading-hyphen
  class names are valid CSS and ubiquitous in utility frameworks. (minor)
- `splitTop` fails open: `margin: 1px) 2px` drives depth negative and all four
  sides receive the literal `"1px) 2px"`. No warning. (minor)
- `flex-flow:` and `list-style:` with an empty value produce no warning, unlike
  the gap/overflow/place/flex/transition guards added in round 4 — the empty-value
  guard set is incomplete. (minor)
- `!important` warnings duplicate once per selector in a comma list. (minor)
- `.x::hover` (double colon on a pseudo-*class*) is accepted as `hover`. (minor)
- Tests that mirror implementation rather than intent: `css.test.ts:141` asserts
  only `warnings.length > 0`; `css.test.ts:167` asserts the internal `"card|is-featured"`
  key-encoding scheme; `longhand.test.ts` `test_FU_M2_16` asserts only that no value
  is `undefined` (trivially true) instead of asserting the warning. (major in aggregate)
- `css.test.ts:132`/`:139` carry doubled snake_case names with no AS id;
  `css.test.ts:43` belongs under AS-041 and is unlabeled. (minor)
- `breakpoints.ts` returns `medium`/`small`/`tiny` while assertions say
  tablet/mobile-landscape/mobile-portrait. Mapping is correct but undocumented;
  AS-070–072 traceability rests on reviewer knowledge. (minor)

## Recommended follow-up features

**FU-A — restore `screen`-prefixed media query support (blocker, AS-048, AS-070–073).**
`mapBreakpoint` must normalise a leading media type before evaluating the width
condition: strip `all`, `screen`, and `only screen` (case-insensitive, with the
`only` keyword optional) and then apply the existing anchored width tests to the
remainder. `print`, `tv`, `speech`, and any other non-screen type must continue to
return `null`. The assertion in `breakpoints.test.ts:47` that currently locks the
wrong behaviour must be inverted, and new cases added for `screen and (max-width:991px)`,
`only screen and (max-width:767px)`, `screen and (min-width:1440px)`, plus retained
negative cases for `print`, `tv`, and `(orientation:landscape)` compounds. Additionally
replace the enumerated non-width-feature blacklist with a whitelist: only an
anchored, fully-consumed `(max-width: Npx)` or `(min-width: Npx)` — after media-type
stripping — may map; anything else returns `null`. Include an end-to-end `parseCss`
case proving a `@media screen` block lands in the correct variant bucket.

**FU-B — make `border`/`outline` shorthand parsing total and non-destructive (blocker, AS-055, AS-056, AS-067).**
`parseBorderParts` must classify each token by kind (width = length/`thin`/`medium`/`thick`/`0`;
style = the CSS line-style keyword set; colour = named colour, hex, or a colour
function) rather than filling slots positionally. Any token that matches no kind —
including `var()` and other unresolvable custom-property references — must produce
a warning naming the property and the token, and must not be written into a slot it
does not belong to. When a `var()` appears anywhere in a border/outline shorthand the
safest behaviour is to drop the whole declaration with an explanatory warning rather
than guess. A token that matches a kind already filled must also warn rather than
silently overwrite or be discarded. Tests must cover: three-token overflow
(`border:1px 2px solid`), `var()` width, `var()` colour, duplicate-kind tokens, and
`border:0`. No input may produce a decl set containing a value of the wrong kind.

**FU-C — convert the AS-069 shorthand gate from a blacklist to a whitelist (blocker, AS-069).**
Invert the default branch of `expandDeclaration`: instead of dropping properties
known to be shorthands and passing everything else through, pass through only
properties on an explicit, reviewed longhand allow-list and warn-and-drop everything
else. Resolve the `SHORTHANDS`/`PASS_THROUGH` contradiction: `grid-column`, `grid-row`,
and `grid-area` cannot be in both — decide whether Webflow accepts them natively and,
if so, remove them from `SHORTHANDS` with a comment explaining the deliberate exception
to AS-069, otherwise remove them from `PASS_THROUGH` and delete the now-dead `grid-area`
entry. Confirmed escapees to close regardless: `white-space`, `overflow-block`,
`overflow-inline`, `scroll-margin-block`, `scroll-margin-inline`. Also remove
`grid-template-areas` from `EXTRA_SHORTHANDS` — it is a longhand and is currently being
dropped wrongly. Add a property-based or corpus-driven test that enumerates every
property the implementation will emit and asserts none of them appears in a hardcoded
shorthand vocabulary.

**FU-D — eliminate silent value corruption in `transition` and `font` (major, AS-063, AS-065).**
`expandTransition` must not substitute a `0s` default for a duration token it failed to
parse; an unparseable time in a transition item must drop that entire item with a warning,
so the output is absent rather than wrong. `expandFont` must recognise `font-stretch`
keywords (`condensed`, `expanded`, `ultra-condensed`, `semi-expanded`, and the rest of the
set, plus percentage forms) in the prelude, and must reject rather than accept a shorthand
with no font-family or with an empty line-height slot (`font:14px`, `font:14px/ Arial`),
warning in both cases. Tests must assert the specific corrupted outputs observed here can
no longer occur: `transition-duration` must never be `0s` when the source token was
unparseable, and `font-size` must never receive a non-length token.

**FU-E — close the warning-loss and silent-drop paths in `css.ts` (major, AS-046).**
Move the `child.important` check above the `try` block so the AS-046 warning is emitted
before any expansion can throw. Add an else-branch to `walk` so a node that is neither a
rule nor an at-rule — such as a declaration sitting directly inside `@media` — produces a
warning instead of vanishing. Warn when a nested `@media` causes an outer breakpoint to be
discarded. Deduplicate `!important` warnings across a comma-separated selector list.
Widen the plain-class-selector regex to accept leading hyphens and CSS escape sequences so
`.-mt-2` and `.w-1\/2` are converted rather than rejected. Add the missing empty-value
guards for `flex-flow` and `list-style`. Harden `splitTop` against unbalanced parentheses
and unterminated quotes, warning rather than returning the input as a single token.

**FU-F — repair vacuous and implementation-mirroring tests (major, AS-135).**
The two AS-069 tests that iterate `Object.keys(shorthandProperties)` must assert the
corpus is non-empty before looping, so a failed import cannot make them pass green with
zero iterations; the same guard belongs in `longhand.ts` where the import is swallowed
into `{}`. `longhand.test.ts:1117` must assert `decls` equals `{}` rather than merely that
the shorthand key is absent. Replace `css.test.ts:141`'s `warnings.length > 0` with a match
on the specific nested-at-rule warning. Stop asserting the internal `"card|is-featured"`
key-encoding scheme in `css.test.ts:167` and the phantom empty standalone entry in
`css.test.ts:214` — assert the observable combo relationship instead. Give
`css.test.ts:132`, `:139`, and `:43` correct single AS labels. Document the
`medium`/`small`/`tiny` ↔ tablet/mobile-landscape/mobile-portrait equivalence in
`breakpoints.ts` so AS-070–AS-072 traceability does not depend on reviewer knowledge.

---

## Appendix — full tool output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  213 passed (213)
   Start at  20:31:20
   Duration  235ms (transform 214ms, setup 266ms, import 175ms, tests 41ms, environment 0ms)
```

Per-file test counts: `longhand.test.ts` 137, `css.test.ts` 51,
`breakpoints.test.ts` 25, `dependency.test.ts` 2.

Assertion IDs referenced anywhere in the M2 test files:
AS-029, AS-039–AS-046, AS-048–AS-050, AS-053–AS-076.
(AS-047, AS-051, AS-052 are HTML-side and belong to M3.)

### `npx eslint lib/webflow-converter/`

```
(no output — clean)
```

### `npx tsc --noEmit` (filtered to lib/webflow-converter)

```
(no diagnostics)
```

### Probe transcript — round-4 directed list

```
.x{background-position:50% 50%}  => base:{'background-position':'50% 50%'} warnings:[]
.x{overscroll-behavior:contain}  => base:{} warnings:[".x: shorthand 'overscroll-behavior' is not supported — write longhands instead"]
.x{border-inline-start:1px solid red} => base:{} warnings:[".x: shorthand 'border-inline-start' is not supported — write longhands instead"]
.x{flex-flow:row wrap extra}     => base:{'flex-direction':'row','flex-wrap':'wrap'} warnings:['.x: flex-flow: unrecognized token "extra" skipped']
.x{gap:}                         => base:{} warnings:['.x: gap: empty value skipped']
.x{gap: }                        => base:{} warnings:['.x: gap: empty value skipped']
.x{overflow:}                    => base:{} warnings:['.x: overflow: empty value skipped']
.x{transition:}                  => base:{} warnings:['.x: transition: empty value skipped']
.x{place-items:}                 => base:{} warnings:['.x: place-items: empty value skipped']
.x{flex:}                        => base:{} warnings:['.x: flex: empty value skipped']
.x{flex-flow:}                   => base:{} warnings:[]          <-- NO WARNING (gap)
.x{list-style:}                  => base:{} warnings:[]          <-- NO WARNING (gap)
.x{font-synthesis:none}          => base:{} warnings:["shorthand 'font-synthesis' is not supported"]
.x{-webkit-box-shadow:0 0 1px red} => base:{} warnings:["shorthand '-webkit-box-shadow' is not supported"]
.x{background-position-x:10px}   => base:{'background-position-x':'10px'} warnings:[]

mapBreakpoint('print and (max-width:767px)')                  => null
mapBreakpoint('screen and (max-width:767px)')                 => null   <-- B-1
mapBreakpoint('(max-width:767px) and (orientation:landscape)')=> null
mapBreakpoint('(max-width:767px)')                            => small
mapBreakpoint('only screen and (max-width:767px)')            => null   <-- B-1
mapBreakpoint('not all and (max-width:767px)')                => null
```

### Probe transcript — shorthand escape sweep

```
.x{margin:1px 2px}         => margin-top:1px margin-right:2px margin-bottom:1px margin-left:2px
.x{inset:0}                => top:0 right:0 bottom:0 left:0
.x{border-width:1px 2px}   => border-top-width:1px border-right-width:2px border-bottom-width:1px border-left-width:2px
.x{grid-area:a}            => {} + warning
.x{text-decoration:...}    => {} + warning
.x{background:red url(..)} => {} + warning
.x{padding-inline:4px}     => {} + warning
.x{columns:2}              => {} + warning
.x{border-image:...}       => {} + warning
.x{animation:spin 1s}      => {} + warning
.x{grid-template:none}     => {} + warning
.x{mask:url(a.png)}        => {} + warning
.x{scroll-margin:4px}      => {} + warning
.x{font-variant:small-caps}=> {} + warning

ESCAPES (emitted verbatim, no warning):
white-space:nowrap         => { 'white-space': 'nowrap' }
overflow-block:hidden      => { 'overflow-block': 'hidden' }
overflow-inline:auto       => { 'overflow-inline': 'auto' }
scroll-margin-block:4px    => { 'scroll-margin-block': '4px' }
grid-column:1 / 3          => { 'grid-column': '1 / 3' }   (isShorthand === true)
grid-row:2 / span 2        => { 'grid-row': '2 / span 2' } (isShorthand === true)
.x{grid-column:1 / 3}      => base:{'grid-column':'1 / 3'} warnings:[]

WRONGLY DROPPED:
grid-template-areas:"a b"  => {} + "shorthand ... not supported"   (it is a longhand)
```

### Probe transcript — silent corruption

```
expandDeclaration('border','1px 2px solid')
  border-top-width:'1px' border-top-style:'solid' border-top-color:'2px'  (x4 sides, NO warning)

expandDeclaration('border','var(--w) solid red')
  border-top-style:'solid' border-top-color:'var(--w)'  (x4 sides; width lost, 'red' lost, NO warning)

expandDeclaration('transition','opacity var(--d) ease')
  transition-property:'opacity' transition-duration:'0s'
  transition-timing-function:'ease' transition-delay:'0s'
  warning: 'transition: unrecognized token "var(--d)" skipped'   (warned, but output is WRONG not absent)

expandDeclaration('font','condensed 14px Arial')
  font-size:'condensed' font-family:'14px Arial'   (NO warning)

parseCss('@media screen and (max-width:991px){.a{color:red}}')
  classes: Map(0) {}
  warnings: ['@media (screen and (max-width:991px)) does not map to a Webflow breakpoint — skipped']

parseCss('@media (max-width:991px){ color:red }')
  classes: Map(0) {}  warnings: []          <-- silent total loss

parseCss('.-mt-2{color:red}')
  classes: Map(0) {}
  warnings: ['selector ".-mt-2" is not a plain class selector — skipped (Webflow styles by class)']
```
