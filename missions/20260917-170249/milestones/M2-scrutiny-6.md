# M2 Scrutiny — Round 6

Mission: 20260917-170249 · Milestone M2 (Conversion engine: CSS)
Date: 2026-09-17 · Prior rounds: R1–R5 all FAIL

## Verdict: **FAIL**

Suite green (225/225, was 213), `npx tsc --noEmit` clean, `npx eslint
lib/webflow-converter/` clean. **All nine directed probes from the round-6 fix
list pass** — the three round-5 blockers (B-1 media prefix, B-2 border garbage,
B-3 shorthand contradiction) are genuinely closed.

The milestone still fails because the round-6 fixes were applied as narrow
patches to the exact inputs round 5 named, and each one left a
structurally-identical hole one token to the left. Four new silent
data-corruption paths, independently reproduced below, are not covered by any
test.

## Round-6 directed probes — all PASS

| # | Probe | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | `npx vitest run lib/webflow-converter/` | 0 failed | 4 files, 225 passed | PASS |
| 2 | `mapBreakpoint('screen and (max-width:991px)')` | `medium` | `medium` | PASS |
| 2b | `only screen and (max-width: 767px)` / `all and (min-width:1440px)` | `small` / `large` | `small` / `large` | PASS |
| 2c | `print`/`tv`/`speech`/`not all` prefixes | `null` | `null` | PASS |
| 3 | `parseBorderParts` classifies by kind | `border:red solid 1px` → correct slots | correct | PASS |
| 3b | `border:var(--w) solid red` | no garbage | `{}` + "var()/calc() in border shorthand" warning | PASS |
| 4 | grid-column/row/area not in PASS_THROUGH | warn-and-drop | all three warn-and-drop | PASS |
| 4b | `[...PASS_THROUGH].filter(isShorthand)` | `[]` | `[]` | PASS |
| 5 | `transition:opacity var(--d) ease` | item dropped, warned | `{}` + "unresolvable duration token — item dropped"; no `0s` | PASS |
| 6 | `font:condensed 14px Arial` | `font-stretch:condensed` | `font-stretch:condensed`, `font-size:14px`, `font-family:Arial` | PASS |
| 7 | AS-069 corpus guard | non-empty floor before loop | `longhand.test.ts:1149` `toBeGreaterThan(10)` | PASS |
| 8 | no property in both vocab and PASS_THROUGH | none | none (`background-position` is PASS_THROUGH by AS-076 mandate) | PASS |
| 9 | tsc + eslint | clean | clean | PASS |

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-039 | PASS | Plain class → base decl set. |
| AS-040 | PASS | Combo keyed `a\|b`, `comboOf:['a']`, order-independent. |
| AS-041 | PASS | All 8 states map incl. `::before`/`::placeholder`. |
| AS-042 | PASS | Descendant warns, no style. |
| AS-043 | PASS | ID selector warns, no style. |
| AS-044 | PASS | Combinator warns, no style. |
| AS-045 | PASS | Attribute selector warns, no style. |
| AS-046 | PASS | Value applied, flag dropped, warning present. Warning text misdescribes (minor); dedup across comma lists still absent (minor). |
| AS-048 | **FAIL** | Uppercase compound queries bypass the non-width guard entirely and map to a breakpoint with zero warning. See B-3. **blocker** |
| AS-049 | PASS | `@keyframes` warns, not converted. |
| AS-050 | PASS | `@font-face` warns, not converted. |
| AS-051 | INCONCLUSIVE | Unused-class detection is HTML-side (M3); nothing in M2 implements it. |
| AS-052 | INCONCLUSIVE | HTML-side; not verifiable from M2 files. |
| AS-053 | PASS | 1/2/3/4 box rule correct. 5th value silently truncated (minor). |
| AS-054 | PASS | Same path as margin. |
| AS-055 | **FAIL** | Colour slot is an unguarded `else` catch-all; modern length units land in `border-*-color` AND evict the real colour. See B-2. **blocker** |
| AS-056 | PASS | Per-side expansion correct; inherits B-2. |
| AS-057 | PASS | TL/TR/BR/BL order correct. |
| AS-058 | PASS | row/column order correct. |
| AS-059 | PASS | x then y. |
| AS-060 | PASS | All three `place-*` correct. |
| AS-061 | PASS | Matches spec resolution. |
| AS-062 | PASS | Order-independent, unknown tokens warned. |
| AS-063 | PASS | Round-5 `0s` corruption fixed — item now dropped with warning. Third time value still swallowed (major, M-3). |
| AS-064 | PASS | Comma list stays mutually aligned; dropped items shift the list (minor). |
| AS-065 | **FAIL** | `font:bold Arial` → `font-size:'Arial'`, no warning. Size slot is never validated as a length. See B-1. **blocker** |
| AS-066 | PASS | type/position/image classified. |
| AS-067 | PASS | width/style/color correct; inherits B-2's catch-all. |
| AS-068 | PASS | Case-insensitive, covers `revert-layer`, inert on longhands. |
| AS-069 | **FAIL** | `marker` and `position-try` are real shorthands emitted verbatim through `parseCss` with no warning. See B-4. **blocker** |
| AS-070 | PASS | `991px` → `medium`; `screen and` form now works. |
| AS-071 | PASS | `767px` → `small`. |
| AS-072 | PASS | `479px` → `tiny`. |
| AS-073 | PASS | 1440/1920/2560 → `large`/`xl`/`xxl`. |
| AS-074 | PASS | No media query → base. |
| AS-075 | PASS | `background-image:url(...)` verbatim, quotes preserved. |
| AS-076 | PASS | Other `background-*` longhands unaffected; `background-position` pass-through is contract-mandated here. |
| AS-135 | **FAIL** | Coverage is shaped around the implementation's happy path, not the assertion's intent: the entire `font` suite feeds a length immediately after the prefix (so B-1 is invisible); `breakpoints.test.ts:72` certifies the very fallthrough that causes B-3; `longhand.test.ts:947` checks only `outline-style` and deliberately never asserts where the third token landed. **major** |

Totals: 30 PASS, 5 FAIL (4 blocker, 1 major), 2 INCONCLUSIVE.

## Blockers

### B-1 — `font` shorthand writes the family into `font-size` (AS-065)

`lib/webflow-converter/longhand.ts:195-203`. After the optional
style/weight/variant/stretch prefix loop, `parts[i]` is taken as the size with
**no check that it is a length**.

```
font: bold Arial     => { "font-weight":"bold",  "font-size":"Arial"    }   warning: none
font: italic Georgia => { "font-style":"italic", "font-size":"Georgia"  }   warning: none
font: var(--font)    => { "font-size":"var(--font)" }                       warning: none
```

Confirmed end to end: `parseCss('.a{font:bold Arial}')` yields
`font-size: Arial` in the payload with `warnings: []`. `expandFont` returns
non-null whenever `out` is non-empty, so the "could not expand" fallback at
`longhand.ts:463` only fires when the prefix loop consumed *everything* — a
family-only tail always escapes it. This is the identical failure class round 5
flagged as B-2 for `border`, fixed there and left standing here.

### B-2 — the border/outline colour slot is an unguarded catch-all (AS-055, AS-056, AS-067)

`longhand.ts:138-141`: after width and style tests fail, the `else` branch
assigns the token to `color` with no colour test at all. Combined with
`isWidth` at `longhand.ts:103-109`, whose unit list
(`px|em|rem|%|vw|vh|vmin|vmax|ch|ex|cm|mm|pt|pc|in|fr`) predates container
queries, viewport variants, and `e`-notation:

```
border: 1svh solid red  => border-*-style:"solid", border-*-color:"1svh"
                           warning: "extra color token 'red' discarded"
border: 1cqw solid red  => same;   1dvh / 1lh / 0.5Q / 1e2px / 1.5e-3em => same
border: 1px solid slid  => border-*-color:"slid"                warning: none
border: solid !important=> border-*-color:"!important"          warning: none
```

Double failure: a length lands in the colour slot **and** the genuine colour is
discarded, while the only warning emitted blames the wrong token and actively
misleads the operator. Round 6 fixed classification-by-position but classified
by an incomplete kind test, so the same garbage still reaches the payload.
(`fr` is also in the width list and is not a valid border width.)

### B-3 — the `mapBreakpoint` non-width guard is a case-sensitive blacklist (AS-048)

`lib/webflow-converter/breakpoints.ts:81-96`. The guard returns `null` only on
two case-**sensitive** patterns (`/\band\b/` at :88, the feature list at :90).
When neither fires, execution falls through to the permissive `/i` extractors
at :113-124. CSS keywords are case-insensitive by spec, so:

```
mapBreakpoint('SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)') => 'small'   (lowercase twin => null)
mapBreakpoint('(MAX-WIDTH:767PX) AND (MONOCHROME)')                       => 'small'
mapBreakpoint('(MAX-WIDTH:991PX) AND (MAX-WIDTH:767PX)')                  => 'medium'
parseCss('@media SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE){.card{color:red}}')
  => card.variants.small = {color:'red'},  warnings: []
```

Landscape-only styles are pasted as unconditional tablet styles with no
warning. AS-048 requires a warning and a skip. `breakpoints.test.ts:72`
(`is case-insensitive and tolerant of extra whitespace`) asserts only
`MAX-WIDTH: 991px`, which travels the fallthrough path — the test certifies
exactly the behaviour that makes this bug possible.

### B-4 — real shorthands still escape verbatim into the payload (AS-069)

`longhand.ts:473-486` default branch. `marker` (shorthand for
`marker-start/-mid/-end`) and `position-try` (shorthand for
`position-try-order/-fallbacks`) are in neither `SHORTHANDS`,
`EXTRA_SHORTHANDS`, nor the `css-shorthand-properties` vocab, so they hit
`return { decls: { [p]: v } }`:

```
parseCss('.a{marker:url(#m);position-try:flip-block}')
  => base: { "marker":"url(#m)", "position-try":"flip-block" },  warnings: []
```

AS-069 admits no exceptions. Round 6 added the five named escapees to
`EXTRA_SHORTHANDS`; it did not convert the blacklist into a whitelist, which is
what round 5's FU-C asked for and what the assertion requires. The AS-069 test
block (`longhand.test.ts:1078-1228`) sweeps the `css-shorthand-properties` vocab
(43 entries) — a vocab that predates both of these properties — so no test can
see them.

## Majors

- **M-1 — malformed media-type prefix accepted.** `breakpoints.ts:46` requires
  `\s+and\s+`, so `screenand (max-width:991px)` is not stripped; `\band\b` then
  finds no word boundary inside `screenand`; fallthrough ⇒ `medium`.
  `parseCss('@media screenand (max-width:991px){.a{color:red}}')` lands in
  `variants.medium` with `warnings: []`. Nonsense converts silently. Same root
  cause as B-3.
- **M-2 — nested `@media` discards the outer condition and warns nobody.**
  `css.ts:141` recurses with only the inner breakpoint.
  `@media (max-width:479px){@media (max-width:991px){.a{color:red}}}` ⇒
  `variants.medium`; the real cascade is ≤479px, so styles land on the **wrong**
  breakpoint. `@media (min-width:1440px){@media (max-width:991px){…}}` ⇒
  `variants.medium` for a rule that can never apply. No test covers nested
  `@media` anywhere. Carried unfixed from round 5.
- **M-3 — `transition` swallows a third time value.** `longhand.ts:240-243`
  routes every time token after the first to `r.delay` unconditionally.
  `transition: opacity 1s 2s 3s` ⇒ `duration:"1s", delay:"3s"`; `2s` vanishes
  with no warning, unlike every sibling path which warns on extras.
- **M-4 — `font: normal normal 14px Arial` loses `font-weight` silently.**
  `longhand.ts:186-193` tests `STYLE` first on every iteration with no
  already-assigned tracking, so the second `normal` re-sets `font-style` instead
  of falling through to weight. Output omits `font-weight` entirely, no warning.
- **M-5 (AS-135) — tests mirror the implementation.** Beyond the three cited in
  the AS-135 row: `css.test.ts:173/184/195/220` assert the internal `"a|b"`
  map-key scheme and the empty-placeholder class entries produced by
  `css.ts:172` — implementation shape, not behaviour; `css.test.ts:147` asserts
  only `warnings.length > 0`; `css.test.ts:138/145/150/155/160` carry mangled,
  doubled snake_case names. The transition tests at `longhand.test.ts:284-333`
  assert the `'0s'`/`'ease'` literals written as initializers at
  `longhand.ts:235`.

## Minors

- Empty value on `border`/`border-top`/`outline`/`margin`/`padding` returns `{}`
  with no warning, while `gap`/`overflow`/`place-*`/`transition`/`flex` all warn
  (`longhand.ts:389/395/401/417/422`). The guard set is still incomplete.
- `box()` (`longhand.ts:79-91`) drops a 5th value silently.
- Declarations sitting directly inside an at-rule vanish with no warning
  (`css.ts:132-158`, bare `return` at :158). Carried from round 5.
- AS-046 warning text — `".card: \"!important\" on color was dropped"` — reads as
  if the declaration were dropped when only the flag was; `css.test.ts:273` pins
  the wording. Still duplicated per selector in a comma list, and carries no
  variant context.
- `(width >= 1440px)` is rejected (`breakpoints.ts:111`) while the equivalent
  `(min-width:1440px)` maps to `large`. Asymmetric with `(width <= Npx)`.
- Dropped `transition` items shift the comma list relative to the source.
- `.-mt-2` and `.w-1\/2` still rejected as "not a plain class selector".
- `medium`/`small`/`tiny` ↔ tablet/mobile-landscape/mobile-portrait equivalence
  is still undocumented in `breakpoints.ts`; AS-070–072 traceability rests on
  reviewer knowledge.

## Recommended follow-up features

**FU-G — validate the `font` size slot and make the prefix loop stateful (blocker, AS-065).**
`expandFont` must require the token it assigns to `font-size` to be a length,
percentage, or one of the absolute/relative size keywords (`xx-small`…`larger`),
and must reject the whole declaration with a warning naming the offending token
when it is not — `font: bold Arial`, `font: italic Georgia`, and `font:
var(--font)` must all produce `{}` plus a warning rather than a family string in
the size slot. The prefix loop must track which of style/weight/variant/stretch
it has already assigned so a repeated `normal` falls through to the next unset
slot instead of overwriting `font-style`, and a genuinely duplicated kind must
warn. A shorthand with no family tail, or with an empty line-height slot
(`font:14px/ Arial`), must also warn rather than silently emit a partial set.
Tests must include at least one case per prefix keyword followed directly by a
family, and must assert that `font-size` can never hold a non-length token.

**FU-H — complete the border/outline kind classifier and close the colour catch-all (blocker, AS-055, AS-056, AS-067).**
Replace the `else`-assigns-to-colour branch with an explicit colour test — named
colour, `#hex`, `rgb()/rgba()/hsl()/hwb()/lab()/lch()/oklch()/color()`,
`currentColor`, `transparent`, plus `invert` for `outline` — and warn-and-drop
any token matching no kind, naming both the property and the token. Widen
`isWidth` to the current CSS length-unit set (`svh/lvh/dvh/svw/lvw/dvw/svmin/
dvmax/cqw/cqh/cqi/cqb/cqmin/cqmax/lh/rlh/Q/rex/rch/ic/cap`) and to scientific
notation, and remove `fr`, which is not a valid border width. When a token
evicts a genuine colour the warning must name the token that was rejected, not
the one that was displaced. Tests must cover each modern unit, an unknown
keyword (`border: 1px solid slid`), an `!important` residue token, and must
assert no value of the wrong kind reaches any `border-*`/`outline-*` longhand.

**FU-I — rewrite the `mapBreakpoint` guard as a case-insensitive whitelist (blocker, AS-048; also fixes M-1).**
Lowercase and collapse whitespace on the query exactly once at the top of
`mapBreakpoint`, then accept only a fully-consumed, anchored form: an optional
`all`/`screen`/`only screen` media type followed by `and`, then exactly one
`(max-width: Npx)` or `(min-width: Npx)` condition and nothing else. Anything
that does not match that grammar in its entirety returns `null` — this closes
uppercase compound queries, `(orientation:…)`/`(monochrome)` compounds, repeated
width conditions, and the malformed `screenand` prefix in a single change, and
turns the extractors at :113-124 into pure extraction with no blacklist ahead of
them. `breakpoints.test.ts:72` must be replaced with cases that travel the guard
rather than the fallthrough, and uppercase variants of every existing negative
case must be added.

**FU-J — convert the AS-069 gate to a longhand allow-list (blocker, AS-069).**
Invert the default branch of `expandDeclaration`: pass through only properties
on an explicit, reviewed longhand allow-list and warn-and-drop everything else,
so a shorthand nobody thought of — `marker` and `position-try` today, the next
CSS module's shorthand tomorrow — cannot reach the payload. Round 6's additive
patch to `EXTRA_SHORTHANDS` cannot satisfy an assertion phrased as a universal.
The accompanying test must enumerate every property the implementation will emit
and assert each one is a longhand, rather than sweeping a third-party vocab that
is necessarily behind the spec.

**FU-K — thread the outer breakpoint through nested at-rules and stop the silent drops (major, AS-048, AS-074; also M-2).**
`css.ts:141` must either intersect the outer and inner `@media` conditions or, at
minimum, warn that the outer condition was discarded and skip the block rather
than filing the styles under the inner breakpoint — today a `≤479px` block
nested in a `≤991px` block lands on tablet, and an unsatisfiable
`min-width:1440px`/`max-width:991px` pair lands on tablet too. Add an
else-branch at `css.ts:158` so a declaration sitting directly inside an at-rule
warns instead of vanishing. Add the missing empty-value guards for `border`,
`border-*`, `outline`, `margin`, and `padding`, warn on a 5th box value in
`box()`, and warn when `transition` receives a third time value instead of
discarding the middle one. Tests must cover nested `@media` at both orders.

**FU-L — replace implementation-mirroring tests with behavioural ones (major, AS-135).**
The `font` suite must include cases where the token after the prefix is not a
length; the outline test at `longhand.test.ts:947` must assert where every token
landed, not just `outline-style`; `breakpoints.test.ts:72` must exercise the
guard path. Stop asserting the internal `"card|is-featured"` key encoding and the
empty-placeholder class entries at `css.test.ts:173/184/195/220` — assert the
observable combo relationship instead. Replace `css.test.ts:147`'s
`warnings.length > 0` with a match on the specific message. Fix the mangled
doubled snake_case test names at `css.test.ts:138/145/150/155/160` and give each
a single correct AS label. Document the `medium`/`small`/`tiny` ↔
tablet/mobile-landscape/mobile-portrait equivalence in `breakpoints.ts`. Add the
`(width >= Npx)` range form so it is symmetric with `(width <= Npx)`.

---

## Appendix — full tool output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  225 passed (225)
   Start at  21:21:58
   Duration  303ms (transform 223ms, setup 494ms, import 186ms, tests 34ms, environment 0ms)
```

### `npx tsc --noEmit`

```
(no diagnostics)
```

### `npx eslint lib/webflow-converter/`

```
(no output — clean)
```

### Probe transcript — round-6 directed list

```
mapBreakpoint("screen and (max-width:991px)")                     => medium
mapBreakpoint("only screen and (max-width: 767px)")               => small
mapBreakpoint("all and (min-width:1440px)")                       => large
mapBreakpoint("print and (max-width:767px)")                      => null
mapBreakpoint("tv and (max-width:767px)")                         => null
mapBreakpoint("speech and (max-width:767px)")                     => null
mapBreakpoint("not all and (max-width:767px)")                    => null
mapBreakpoint("screen and (max-width:767px) and (orientation:landscape)") => null
mapBreakpoint("(max-width:479px)")                                => tiny
mapBreakpoint("SCREEN AND (MAX-WIDTH:991px)")                     => medium
mapBreakpoint("screenx and (max-width:991px)")                    => null

border:1px 2px solid      => width/style set, warning "extra width token '2px' discarded"
border:var(--w) solid red => {} + "var()/calc() in border shorthand — use individual border-* properties instead"
border:red solid 1px      => width 1px / style solid / color red  (order-independent)
border:0                  => border-*-width:0
outline:var(--x) solid red=> {} + same var() warning
transition:opacity var(--d) ease => {} + "unresolvable duration token \"var(--d)\" — item dropped"
transition:opacity .3s ease      => property/duration/timing/delay, no warning
font:condensed 14px Arial        => font-stretch:condensed font-size:14px font-family:Arial
font:ultra-expanded bold 14px/1.5 Arial => stretch/weight/size/line-height/family
grid-column:1 / 3  => {} + "shorthand 'grid-column' is not supported"
grid-row:2 / span 2=> {} + same
grid-area:a        => {} + same
grid-template-areas:"a b" => { 'grid-template-areas': '"a b"' }   (now correctly a longhand)
overflow-block / overflow-inline / scroll-margin-block / scroll-margin-inline => {} + warning

[...PASS_THROUGH].filter(isShorthand) => []
css-shorthand-properties vocab size   => 43
vocab props emitted verbatim          => ['background-position']   (mandated by AS-076)
vocab props emitting a shorthand key  => []

parseCss('@media screen and (max-width:991px){.a{color:red}}')
  => classes: [["a",{base:{},variants:{medium:{color:"red"}},comboOf:null}]], warnings: []
```

### Probe transcript — round-6 defects (independently reproduced)

```
font:bold Arial          => {"font-weight":"bold","font-size":"Arial"}        no warning   <-- B-1
font:italic Georgia      => {"font-style":"italic","font-size":"Georgia"}     no warning   <-- B-1
font:var(--font)         => {"font-size":"var(--font)"}                       no warning   <-- B-1
font:normal normal 14px Arial => {"font-style":"normal","font-size":"14px","font-family":"Arial"}
                                 font-weight lost, no warning                              <-- M-4

border:1svh solid red    => border-*-style:"solid", border-*-color:"1svh"
                            warning: "extra color token 'red' discarded"                   <-- B-2
                            (same for 1cqw, 1dvh, 1lh, 0.5Q, 1e2px, 1.5e-3em)
border:1px solid slid    => border-*-color:"slid"                             no warning   <-- B-2
border:solid !important  => border-*-color:"!important"                       no warning   <-- B-2

transition:opacity 1s 2s 3s => duration:"1s", delay:"3s"   "2s" lost, no warning            <-- M-3

marker:url(#m)           => { "marker":"url(#m)" }                            no warning   <-- B-4
position-try:flip-block  => { "position-try":"flip-block" }                   no warning   <-- B-4

mapBreakpoint('SCREEN AND (MAX-WIDTH:767PX) AND (ORIENTATION:LANDSCAPE)') => small         <-- B-3
mapBreakpoint('(MAX-WIDTH:767PX) AND (MONOCHROME)')                       => small         <-- B-3
mapBreakpoint('(MAX-WIDTH:991PX) AND (MAX-WIDTH:767PX)')                  => medium        <-- B-3
mapBreakpoint('screenand (max-width:991px)')                              => medium        <-- M-1

parseCss('@media (max-width:479px){@media (max-width:991px){.a{color:red}}}')
  => a.variants.medium = {color:"red"}, warnings: []   (should be tiny, or warn)           <-- M-2
parseCss('@media (max-width:767px){ .a{color:red} color: blue; }')
  => "color:blue" gone, warnings: []                                                       <-- minor
```
