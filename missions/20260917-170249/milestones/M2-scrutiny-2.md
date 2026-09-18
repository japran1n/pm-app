# M2 scrutiny — round 2 — Conversion engine: CSS (F005–F014, +F051–F056)

_Mission 20260917-170249 · 2026-09-17 · read-only adversarial re-review_

## VERDICT: **FAIL** — 3 blockers, 6 majors

The four blockers from round 1 are **genuinely fixed** — I verified each by
probe, not by reading the commits. But the round-1 fixes were applied to the
*instances* named in the report rather than to the *defect classes*, and each
of the three new blockers is the same class of bug surfacing one step to the
left. Suite is 179/179 green, `tsc --noEmit` clean, `npm run lint` clean.
Green remains not evidence.

## Round-1 blockers: re-verified

| Was | Now | Probe evidence |
|---|---|---|
| B1 / AS-069 | **FIXED (for in-set props)** | `background`/`animation`/`grid`/`grid-template`/`grid-area` → `{decls:{}}` + `"shorthand 'X' is not supported — write longhands instead"`. `grid-gap` now really expands to `row-gap`/`column-gap`. A 20-property real-world corpus through `parseCss` yields `SHORTHAND LEAKS: []` for every key of every base and variant. `font: 450 15px Inter` → `font-weight:450` (CSS4 weight fix holds). |
| B2 / AS-048 | **FIXED (for simple queries)** | `mapBreakpoint('(max-width:1200px)')` → `null`; `(min-width:600px)` → `null`. `parseCss` emits `"...does not map to a Webflow breakpoint — skipped"` and produces **zero** class entries. 991/767/479 → medium/small/tiny and 1440/1920/2560 → large/xl/xxl still correct. |
| B3 / AS-039+040 | **FIXED** | `.b{color:red} .a.b{color:blue}` → two records: `b` = `{base:{color:red}, comboOf:null}` and `a\|b` = `{name:"b", base:{color:blue}, comboOf:["a"]}`. Order-independent (reversed source gives the same result). `.a.b.c` → `comboOf:["a","b"]` — both ancestors retained. `.a.b` and `.c.b` no longer collide. |
| B4 / AS-057 + nesting | **FIXED (for the named cases)** | `border-radius: calc(100%/2)` → four equal corners, **no** bogus elliptical warning; `10px / 20px` still warns correctly. `.a{color:red; .b{color:blue}}` → `a.base={color:red}` preserved, plus `".a: nested CSS rules are not supported"`. Parent declarations are no longer clobbered. |

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-039 | PASS | `.card{...}` → one class definition. Chain keys keep standalone and combo separate. |
| AS-040 | PASS | `comboOf: string[]`; `.a.b.c` → `["a","b"]`; base classes registered separately. |
| AS-041 | PASS | All 8 states map; `:active`→`pressed`; `:hover:focus` rejected. Minor: `.x::hover` still accepted. |
| AS-042 | PASS | Descendant → warning, 0 classes. Now has a real parseCss-level test. |
| AS-043 | PASS | ID → warning, 0 classes. |
| AS-044 | PASS | `>` and `+` both → warning, 0 classes. Now labelled and tested. |
| AS-045 | PASS | Attribute → warning, 0 classes. |
| AS-046 | PASS (minor) | Flag dropped, decl applied, one warning. Only tested on `color`; the shorthand+`!important` path works but is untested. |
| AS-047 | N/A | HTML-side (M3). |
| AS-048 | **FAIL (major)** | Simple queries fixed, but `mapBreakpoint` still regex-scrapes the first `max-width` and ignores `not`, `only`, and co-conditions. `@media not all and (max-width:767px)` (a desktop query) → `small`. `@media (min-width:768px) and (max-width:991px)` (tablet-only) → `medium`, which in Webflow cascades *down* to mobile. Both silent, zero warnings, untested. |
| AS-049 | PASS | Warns with "page custom code", no style. Label now correct. |
| AS-050 | PASS | Warns with "Webflow site settings", no style. Label now correct. |
| AS-051 | **FAIL (major)** | Needs HTML (M3) — but `css.test.ts:124` and `:131` are *labelled* AS-051 while actually testing breakpoint variant keys. AS-051 reads as covered and is not. |
| AS-052 | **FAIL (major)** | Same: `css.test.ts:151` is labelled AS-052 but is a combo-class test. |
| AS-053 | PASS (major) | 1/2/3/4 correct, `var()`/`calc()` preserved. `margin:1px 2px 3px 4px 5px` silently truncates; empty value → `{}` silently. Untested. |
| AS-054 | PASS (major) | Same path, same silent drops. |
| AS-055 | PASS (major) | Four sides correct; `var()`-as-width **fixed** (`border: solid var(--accent)` → `border-*-color`). But `border: 1px solid red blue` silently discards `blue`. |
| AS-056 | PASS | Only the named side's three longhands. Verified all four. |
| AS-057 | **FAIL (blocker, see NB2)** | `calc(100%/2)` fixed. But `border-radius: ;` and `border-radius:/**/;` throw an uncaught `TypeError: Cannot read properties of undefined (reading 'trim')` out of `expandBorderRadius`'s destructure, killing the entire conversion. And `border-radius: / 4px` writes the *vertical* radii into all four corners with no elliptical warning (the empty leading segment is discarded, so `length===1`). |
| AS-058 | PASS (major) | 1→both, 2→row/column; `grid-gap` aliased. Third value silently dropped. |
| AS-059 | PASS (major) | 1→both, 2→x/y. Third value silently dropped. |
| AS-060 | PASS (major) | All three pairs correct; extra tokens silently dropped. |
| AS-061 | PASS (minor) | `none`/`auto`/number/2-value/3-value all spec-correct. `flex: initial` is dropped by the global-keyword guard rather than expanding to `0 1 auto` — this is **contract-conformant**: AS-068 names `initial` explicitly, so AS-068 wins the round-1 contradiction. The dead branch is gone. `longhand.test.ts:356` still justifies it by "like the reference prototype" rather than by AS-068 — cite the assertion. |
| AS-062 | PASS (major) | Order-independent, but *any* non-wrap token becomes `flex-direction`, last wins: `flex-flow: wrap row extra` → `flex-direction: extra`. No warning. |
| AS-063 | PASS (major) | Spec defaults `all/0s/ease/0s` correct. An unrecognised token clobbers `transition-property` silently (`opacity .2s foo bar` → property `bar`). |
| AS-064 | PASS | Paren-aware comma split; `cubic-bezier(...)` and `steps(4, end)` survive; positional alignment verified for 2 and 3 items. |
| AS-065 | **FAIL (major)** | CSS4 numeric weights **fixed** (450 works) and the verbatim-shorthand re-emit is gone. But CSS permits whitespace around the size/line-height slash: `font: 14px / 1.5 Arial` → `{font-size:"14px", font-family:"/ 1.5 Arial"}` — no line-height, garbage family, no warning. `small-caps` still consumed and discarded. `font: caption` → `font-size: caption`. Unparseable values fall to `font-size` silently. |
| AS-066 | PASS (major) | type/position/image routed; unknown tokens still last-wins into `list-style-type` with no warning. |
| AS-067 | **FAIL (major)** | `auto` is not in `BORDER_STYLES`, so the near-universal focus-ring idiom `outline: 2px auto -webkit-focus-ring-color` → `{outline-width:"2px", outline-color:"auto"}`: the style is lost, the real colour token is silently discarded, no warning. Assertion requires width+style+color. |
| AS-068 | PASS | Case-insensitive, gated on `isShorthand`, covers `revert-layer`, returns `{}` + warning. |
| AS-069 | **FAIL (blocker, NB1)** | See below. |
| AS-070/071/072 | PASS | 991→medium, 767→small, 479→tiny; exact-match only. |
| AS-073 | PASS | 1440/1920/2560 → large/xl/xxl. |
| AS-074 | PASS | No media query → base; `variantKey('main', null)` → null. Labels now correct. |
| AS-075 | PASS | `url("/img/hero.jpg")` byte-identical, quotes intact. |
| AS-076 | PASS | `background-color`/`-position`/`-size` coexist with `background-image` untouched. |
| AS-135 | **FAIL (major)** | Four mislabels remain, one inside the 053–068 range AS-135 explicitly polices. |

---

## Blockers

### NB1 — AS-069: the shorthand escape hatch was narrowed, not closed

F051 made `expandDeclaration`'s `default:` branch warn-and-drop **only when
`isShorthand(prop)` is true**. Every CSS shorthand that is simply absent from
the `SHORTHANDS` set still falls through and is emitted verbatim, unwarned,
straight into the class payload. Confirmed by probe through `parseCss`:

```
.card{text-decoration:underline dotted red; columns:2 100px; mask:url(m.svg); all:unset; grid-column:1/3}
-> base = {"text-decoration":"underline dotted red","columns":"2 100px",
           "mask":"url(m.svg)","all":"unset","grid-column":"1/3"}
   warnings = []
```

Also leaking: `border-image`, `offset`, `text-emphasis`, `scroll-margin`,
`text-wrap`, `grid-row`, `container`, `background-position`, and the entire
logical-property family (`margin-inline`, `padding-block`, `inset-inline`,
`border-block`). `text-decoration: underline dotted red` is ordinary
hand-written CSS and is the single most likely real-world trigger.

AS-069 is absolute: *"No class in a successfully converted payload contains
**any** shorthand CSS property."* It is false today. The test at
`longhand.test.ts:996` cannot catch this because it feeds `parseCss` only
properties that are already in `SHORTHANDS` — it proves the set is handled,
not that the payload is shorthand-free. That is a test mirroring the
implementation: it is derived from the same list it is meant to audit.

### NB2 — `parseCss` throws; one bad declaration aborts the whole conversion

Two distinct throw paths, neither tested, and `css.ts:98` documents the
opposite ("Never throws for expected-bad input"):

1. **Internal TypeError.** `expandBorderRadius` destructures
   `const [horiz] = splitTop(value, /\//)`; for an empty or comment-only value
   `horiz` is `undefined` and `.trim()` throws.
   `parseCss('.a{border-radius: ;}')` → `TypeError: Cannot read properties of
   undefined (reading 'trim')`. This is not unparseable input — it is valid,
   parseable CSS that kills an otherwise-complete conversion. `css.ts:165` has
   no try/catch, so there is no per-declaration containment.
2. **Uncaught postcss syntax error.** `parseCss('.card { color: red;')` →
   `CssSyntaxError: Unclosed block`. AS-029 makes "unparseable input shows a
   clear error message" a UI obligation, so this is survivable *if* the M3
   caller catches it — but `parseCss` is currently imported only by tests, so
   nothing proves it will be, and the docstring actively misleads the future
   caller into not wrapping it.

Path 1 is the blocker; path 2 is a latent trap.

### NB3 — silent declaration loss via at-rules (the B4 defect class, reopened)

F054 added a `"nested CSS rules are not supported"` warning for nested
*rules*, but the inner loop at `css.ts:163` handles only `type === "decl"` and
`type === "rule"`. An `atrule` child is skipped with no branch and no warning:

```
.a { color:red; @media (max-width:767px){ color:blue } }
-> {a: {base:{color:"red"}, variants:{}}}   warnings: []     <-- color:blue vanished
```

Separately, `css.ts:124–140` handles only media/supports/layer/keyframes/
font-face; every other at-rule hits a bare `return`:

```
@container (max-width:500px){ .a{color:red} }  -> 0 classes, 0 warnings
@page{margin:1cm}                              -> 0 classes, 0 warnings
@import url(x.css);                            -> 0 classes, 0 warnings
```

`@container` is mainstream in current CSS. A designer pastes a stylesheet, a
whole block of styles disappears, and the app reports nothing wrong. This is
exactly the failure mode B4 was raised to eliminate — silently wrong output
with no signal — merely relocated from `walkDecls` to the at-rule dispatch.

---

## Majors

- **M-a — AS-048 compound/negated media queries silently mis-map.**
  `not all and (max-width:767px)` → `small`; `(min-width:768px) and
  (max-width:991px)` → `medium`. `breakpoints.test.ts` only ever feeds
  single-condition strings.
- **M-b — AS-135 mislabels persist after F055.** `css.test.ts:144` is labelled
  AS-057 (it is a nesting test, and AS-057 is in the range AS-135 polices);
  `:124`/`:131` are labelled AS-051; `:151` is labelled AS-052. AS-051 and
  AS-052 have **no** real test anywhere yet read as covered. A naive grep for
  assertion IDs — the obvious way to run F039's coverage audit — returns a
  false pass. The audit needs label-to-subject verification, not ID presence.
- **M-c — AS-067 `outline-style: auto` unsupported**, losing the style and
  poisoning the colour slot on the standard focus-ring idiom.
- **M-d — AS-065 spaced `font` slash** produces a garbage `font-family` and no
  `line-height`, silently; `small-caps` and system-font keywords dropped.
- **M-e — Pervasive silent token loss.** Every expander discards surplus or
  unrecognised tokens without a warning: box `>4` values, `parseBorderParts`
  leftovers, `gap`/`overflow` third values, `place-*` extras,
  `transition` unknown tokens (which *clobber* `transition-property`),
  `list-style` unknown tokens, `flex-flow` unknown tokens (which clobber
  `flex-direction`). A user gets a conversion that looks clean and is wrong.
- **M-f — AS-057 leading-slash form** `border-radius: / 4px` applies the
  vertical radii to all four corners with no warning.

## Minors

- `.x::hover` (invalid double-colon) accepted as hover.
- `@supports` is transparently unwrapped with no warning — conditionally-applied
  styles become unconditional.
- Self-confirming constant tests: `css.test.ts:75` (`STATE_ALIASES` deep-equals
  its own literal) and `breakpoints.test.ts:92` (`BREAKPOINTS` likewise). These
  cannot fail for any reason a user would care about.
- Empty variant buckets: a media block whose declarations are all dropped still
  creates `variants: {small: {}}`.
- Non-terminal chain members (`a`, `b` in `.a.b.c`) are still pushed into
  `order` with empty base and variants. Defensible now (M4/AS-117 needs the
  base class registered) — but decide it deliberately and document it, because
  downstream emitters will otherwise ship empty class definitions.
- `isWidth` still matches `1.2.3px` and bare `5`.
- Tailwind-escaped class names (`.w-1\/2`) are rejected with the generic
  non-class-selector warning; nothing pins this either way.

## Behaviour changes no current test would catch

- Adding or removing any entry from `SHORTHANDS` (the AS-069 test is derived
  from that same set).
- Changing the `>4`-value truncation rule, or `box()`'s 3-value rule for
  `border-width`/`border-color`.
- Making `expandTransition` ignore a stray token instead of clobbering
  `transition-property`.
- Removing `revert-layer` from the global-keyword regex.
- Any change to `expandFont`'s slash, `small-caps`, or system-keyword handling.
- Starting to silently drop *more* at-rule kinds.
- Swapping `min-width`/`max-width` handling for compound queries.
- `parseCss` gaining or losing throw-safety.
- Regressing last-wins declaration order to first-wins.

---

## Recommended follow-up features

**FU-M2-7 — Make AS-069 self-auditing instead of self-confirming (blocker).**
The current guard only fires for properties already in `SHORTHANDS`, so the
set's incompleteness *is* the vulnerability. Invert the control: derive the
shorthand vocabulary from an independent source (a maintained package such as
`css-shorthand-properties`, or a checked-in list generated from the CSS
specs and annotated with its provenance) rather than from a hand-maintained
literal, and have `expandDeclaration`'s `default:` branch warn-and-drop any
property in that vocabulary. At minimum add `text-decoration`, `columns`,
`mask`, `border-image`, `offset`, `text-emphasis`, `scroll-margin`,
`scroll-padding`, `grid-column`, `grid-row`, `all`, `container`, `text-wrap`
and the logical-property families (`margin-inline`, `margin-block`,
`padding-inline`, `padding-block`, `inset-inline`, `inset-block`,
`border-inline`, `border-block`). Rewrite the AS-069 test so its corpus comes
from that independent vocabulary and not from the module's own set — the test
must fail when the set and the vocabulary diverge, which is the only way it
can ever have caught this.

**FU-M2-8 — No single declaration may abort a conversion (blocker).**
Guard `expandBorderRadius` against empty, comment-only, and leading-slash
values: return `{decls:{}}` plus a warning naming the property rather than
destructuring into `undefined`, and detect the `/ 4px` form so the vertical
radii are not mistaken for horizontal ones. Then wrap the per-declaration
expansion at `css.ts:165` in a try/catch that converts any unexpected throw
into a warning and continues, so an engine bug degrades one declaration
instead of the whole paste. Separately, either catch `postcss.parse`'s
`CssSyntaxError` at `css.ts:102` and return it as a structured failure, or
correct the docstring at `css.ts:98` and give `parseCss` an explicit documented
throw contract that the AS-029 caller is built against. Add tests for empty
values, comment-only values, and truncated stylesheets.

**FU-M2-9 — At-rules must never disappear silently (blocker).**
Handle `atrule` children inside rules: native-nested `@media` should either be
hoisted into the correct breakpoint variant or, at minimum, emit the same
"nested rules are not supported" warning that nested *rules* now get — today
its declarations vanish with zero warnings. Add a catch-all branch for
unrecognised top-level at-rules (`@container`, `@scope`, `@page`, `@import`,
`@property`, `@counter-style`) that emits `"@<name> is not supported — N rules
skipped"`, matching the treatment `@media` already receives. Add a test
asserting that for any stylesheet, the number of declarations that reach the
payload plus the number of warnings accounts for every declaration in the
input — a conservation check that makes silent loss structurally impossible.

**FU-M2-10 — Warn on every discarded token (major).**
Introduce a single helper used by all expanders that records "value X of
property P was discarded" and route every current silent-drop site through it:
box shorthands beyond 4 values, `parseBorderParts` leftovers, `gap`/`overflow`
third values, `place-*` extras, and the unknown-token paths in `transition`,
`list-style` and `flex-flow` (which today *overwrite* `transition-property` and
`flex-direction` rather than being ignored — ignoring with a warning is the
safer behaviour). The user-visible outcome should be that a conversion is
either faithful or noisy, never quietly lossy.

**FU-M2-11 — Media-query condition parsing (major, AS-048).**
Replace the first-match regex scrape in `mapBreakpoint` with a real parse of
the media condition: reject (with a warning) any query carrying `not` or
`only`, and any query combining a `min-width` and a `max-width`, rather than
snapping to whichever bound the regex happens to find first. Today
`@media not all and (max-width:767px)` — a desktop-and-up query — becomes
Webflow's mobile variant. Add cases for negation, `only screen`, compound
`and` conditions, comma-separated query lists, and range syntax
(`@media (width <= 767px)`), which the current regex does not recognise at all.

**FU-M2-12 — Value-vocabulary gaps in `outline` and `font` (major).**
Add `auto` to the outline style vocabulary so `outline: 2px auto
-webkit-focus-ring-color` yields width+style+color instead of silently losing
the style and putting `auto` in the colour slot. Normalise whitespace around
the `font` shorthand's size/line-height slash before the `includes('/')` check
so `font: 14px / 1.5 Arial` parses identically to `font: 14px/1.5 Arial`;
today it produces a garbage `font-family` of `"/ 1.5 Arial"` and no
line-height. Emit `font-variant: small-caps` rather than consuming and
discarding it, and warn on system-font keywords (`caption`, `menu`,
`status-bar`) instead of assigning them to `font-size`.

**FU-M2-13 — Verify test labels against assertion subjects (major, AS-135).**
F055 corrected some labels but four remain wrong, and they are worse than
missing labels because they make a grep-based coverage audit return a false
pass: `css.test.ts:144` claims AS-057 for a nesting test, `:124`/`:131` claim
AS-051, `:151` claims AS-052 — so AS-051 and AS-052 read as covered while
having no test at all. Correct these, and replace the ID-presence check that
F039 relies on with one that requires each labelled test to be reviewed against
the verbatim assertion text, recording the mapping in a checked-in file. Also
re-anchor `longhand.test.ts:356` (`flex: initial`) to cite AS-068 as its
justification rather than "the reference prototype" — the behaviour is correct
but the stated reason is not a requirement. Finally, delete or rewrite the two
constant-mirroring tests (`css.test.ts:75`, `breakpoints.test.ts:92`) that
assert a module's literals against copies of themselves.

---

## Command output

### `npx vitest run lib/webflow-converter/`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  4 passed (4)
      Tests  179 passed (179)
   Start at  19:36:01
   Duration  225ms (transform 190ms, setup 254ms, import 158ms, tests 34ms)
```

### `npx tsc --noEmit`
```
(no output — clean)
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint
(no output — clean)
```

### Independent probes (tsx, against the shipped modules)

**Round-1 blockers — all confirmed fixed**
```
background     isShorthand=true {"decls":{},"warning":"shorthand 'background' is not supported — write longhands instead"}
animation      isShorthand=true {"decls":{},"warning":"shorthand 'animation' ..."}
grid           isShorthand=true {"decls":{},"warning":"shorthand 'grid' ..."}
grid-template  isShorthand=true {"decls":{},"warning":"shorthand 'grid-template' ..."}
grid-area      isShorthand=true {"decls":{},"warning":"shorthand 'grid-area' ..."}
grid-gap       isShorthand=true {"decls":{"row-gap":"1px","column-gap":"2px"}}
font 450 15px Inter          -> {"font-weight":"450","font-size":"15px","font-family":"Inter"}

mapBreakpoint('(max-width:1200px)') -> null
mapBreakpoint('(min-width:600px)')  -> null
mapBreakpoint('(max-width:991px)')  -> "medium"   (767->"small", 479->"tiny")
mapBreakpoint('(min-width:1440px)') -> "large"    (1920->"xl", 2560->"xxl")
parseCss('@media (max-width:1200px){.a{color:red}}')
  order: []   warn: ["@media ((max-width:1200px)) does not map to a Webflow breakpoint — skipped"]

parseCss('.b{color:red} .a.b{color:blue}')
  b   => {"name":"b","base":{"color":"red"},"variants":{},"comboOf":null}
  a|b => {"name":"b","base":{"color":"blue"},"variants":{},"comboOf":["a"]}
parseCss('.a.b{color:blue} .b{color:red}')   -> identical (order-independent)
parseCss('.a.b.c{color:green}')  a|b|c => comboOf:["a","b"]
parseCss('.a.b{color:1} .c.b{color:2}')  -> a|b and c|b, no collision

border-radius calc(100%/2) -> four equal corners, NO warning
border-radius 10px / 20px  -> horizontal values + elliptical warning
parseCss('.a{color:red; .b{color:blue}}')
  a => base {"color":"red"}   warn [".a: nested CSS rules are not supported"]
parseCss('.z{color:green; &:hover{color:black}}')
  z => base {"color":"green"} warn [".z: nested CSS rules are not supported"]
border solid var(--accent) -> border-*-color: var(--accent)   (no longer a width)
```

**20-property real-world corpus through parseCss**
```
SHORTHAND LEAKS: []          (for every key of base and every variant)
warnings: background / animation / grid-area / grid-template / grid unsupported;
          margin:inherit, padding:initial, font:unset dropped (global keyword)
background-image url("/img/x.jpg"), background-color, background-position all preserved
```

**NB1 — AS-069 leak via properties outside SHORTHANDS**
```
text-decoration     inSet=false {"decls":{"text-decoration":"underline dotted red"}}
columns             inSet=false {"decls":{"columns":"..."}}
mask                inSet=false {"decls":{"mask":"..."}}
border-image        inSet=false  offset inSet=false  text-emphasis inSet=false
margin-inline       inSet=false  border-block inSet=false  scroll-margin inSet=false
background-position inSet=false  all inSet=false  container inSet=false
text-wrap           inSet=false  grid-column inSet=false  grid-row inSet=false

parseCss('.card{text-decoration:underline dotted red; columns:2 100px;
                mask:url(m.svg); all:unset; grid-column:1/3}')
 -> base = {"text-decoration":"underline dotted red","columns":"2 100px",
            "mask":"url(m.svg)","all":"unset","grid-column":"1/3"}
    warnings = []
```

**NB2 — throws**
```
parseCss('.a{border-radius: ;}')     *** THREW: Cannot read properties of undefined (reading 'trim')
parseCss('.a{border-radius:/**/;}')  *** THREW: Cannot read properties of undefined (reading 'trim')
parseCss('.card { color: red;')      *** THREW: CssSyntaxError: Unclosed block
parseCss('.a{border-radius: / 4px}') -> all four corners = "4px", warnings []   (vertical radii, no warning)
```

**NB3 — silent at-rule loss**
```
parseCss('.a{color:red; @media (max-width:767px){color:blue}}')
 -> [{"name":"a","base":{"color":"red"},"variants":{}}]  warnings []   <-- color:blue vanished
parseCss('@container (max-width:500px){.a{color:red}}')  -> 0 classes, 0 warnings
parseCss('@page{margin:1cm}')                            -> 0 classes, 0 warnings
parseCss('@import url(x.css);')                          -> 0 classes, 0 warnings
parseCss('@supports (display:grid){.a{color:red}}')      -> applied unconditionally, 0 warnings
```

**Majors**
```
@media not all and (max-width:767px)          -> variants.small    warnings []
@media (min-width:768px) and (max-width:991px) -> variants.medium  warnings []
outline: 2px auto -webkit-focus-ring-color -> {"outline-width":"2px","outline-color":"auto"}
font: 14px / 1.5 Arial -> {"font-size":"14px","font-family":"/ 1.5 Arial"}
font: 14px/1.5 Arial   -> {"font-size":"14px","line-height":"1.5","font-family":"Arial"}
font: bogusvalue       -> {"font-size":"bogusvalue"}   (no warning)
flex: initial          -> {} + "global keyword on a shorthand"  (AS-068-conformant)
```

**Selector / at-rule behaviour sweep**
```
@keyframes spin{...}   -> 0 classes, "@keyframes \"spin\" cannot be pasted — move it to page custom code"
@font-face{...}        -> 0 classes, "@font-face cannot be pasted — upload the font in Webflow site settings"
#hero / [data-x] / .a h3 / a.btn > span / .a + .b  -> 0 classes + non-plain-class warning
.a{color:red !important} -> {"color":"red"} + "\"!important\" on color was dropped"
.a::placeholder/.a::before/.a:focus-visible/.a:visited -> main_placeholder/main_before/main_focus-visible/main_visited
.a:hover:focus         -> rejected with warning
.a::hover              -> ACCEPTED as main_hover   (minor)
@media print           -> 0 classes + unmappable warning
```

### Test-label ID sweep
```
IDs present in lib/webflow-converter/*.test.ts for the M2 range AS-039..AS-076:
  all present except AS-047 (HTML-side, M3)
BUT four are attached to the wrong subject:
  css.test.ts:144  labelled AS-057 -> actually a CSS-nesting test
  css.test.ts:124  labelled AS-051 -> actually a breakpoint variant-key test
  css.test.ts:131  labelled AS-051 -> actually a breakpoint variant-key test
  css.test.ts:151  labelled AS-052 -> actually a combo-class test
=> AS-051 and AS-052 have no real test but read as covered.
```
