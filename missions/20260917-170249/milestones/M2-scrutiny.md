# M2 scrutiny — Conversion engine: CSS (F005–F014)

_Mission 20260917-170249 · date 2026-09-17 · read-only adversarial review_

## VERDICT: **FAIL** — 4 blockers, 6 majors

Suite is green (154/154), `npm run lint` clean, `npx tsc --noEmit` clean.
Green is not evidence: the three highest-consequence defects below are each
*enshrined by a passing test* that asserts the implementation's behaviour
rather than the assertion's intent.

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-039 | FAIL (major) | A class that is both standalone and a combo target shares ONE bucket — `.b{color:red} .a.b{color:blue}` yields a single `b` whose base is `{color:blue}`; the standalone rule is destroyed. Nested CSS also leaks (see B4). |
| AS-040 | FAIL (blocker) | `comboOf` is retroactively mutated on an existing standalone class, and 3-deep chains (`.a.b.c`) record only `c.comboOf==="b"` — the `.a` requirement is lost. |
| AS-041 | PASS | All 8 states map; `:before`/`::before` both accepted; `:hover:focus` correctly rejected. Cosmetic: `.x::hover` is wrongly accepted. |
| AS-042 | PASS | Descendant → warning, no style. Verified. |
| AS-043 | PASS | ID → warning, no style. |
| AS-044 | INCONCLUSIVE (minor) | Implementation rejects `>`/`+`/`~`, but no parseCss-level test exercises a combinator; the "non-class selectors" test uses descendant/id/element/attribute only. |
| AS-045 | PASS | Attribute → warning, no style. |
| AS-046 | PASS | postcss strips `!important` from `decl.value`; declaration applied, one warning emitted. |
| AS-047 | N/A | Inline `style=""` is HTML-side (M3). |
| AS-048 | **FAIL (blocker)** | `mapBreakpoint` never returns null for any max-width or min-width. `@media (max-width:1200px)` silently maps to `medium` (tablet); `@media (min-width:600px)` silently maps to `large`. Zero warnings. The test carrying this behaviour (`breakpoints.test.ts:27`) *asserts the fallback is correct*. The only unmappable case tested is `@media print`, which is not a max-width and never exercises the assertion. |
| AS-049 | PASS (impl) / FAIL (traceability, major) | `@keyframes` warns and produces no style — but the test labelled `AS-049` (`css.test.ts:102`) is about a plain class rule; the real keyframes test carries no ID. |
| AS-050 | PASS (impl) / FAIL (traceability, major) | Same: `@font-face` behaves correctly; the `AS-050` label sits on the margin-shorthand test. |
| AS-051 | N/A | Defined-but-unreferenced check is an M3 concern (needs HTML). |
| AS-052 | N/A | M3. |
| AS-053 | PASS | `box()` implements 1/2/3/4 correctly; `splitTop` protects `var()`/`calc()`. Verified `margin:1px 2px 3px` → `2px` left. |
| AS-054 | PASS | Same code path. |
| AS-055 | PASS (major caveat) | All four sides emitted, but `isWidth()` matches `var(`/`calc(`, so `border: solid var(--accent)` puts the colour token into `border-*-width`. Confirmed by probe. The test at `longhand.test.ts:629` blesses this "matching the reference prototype". |
| AS-056 | PASS | Single-side branch emits only that side's three longhands. |
| AS-057 | **FAIL (blocker)** | `expandBorderRadius` splits on `/` in the RAW string, ignoring parens. `border-radius: calc(100%/2)` produces four corners of literal `calc(100%` plus a bogus "elliptical radii" warning. `splitTop` exists to prevent exactly this and is not used. Untested. |
| AS-058 | PASS | 1→both, 2→row/column. |
| AS-059 | PASS | 1→both, 2→x/y. |
| AS-060 | PASS | All three place-* pairs correct. |
| AS-061 | FAIL (major) | `flex: initial` never reaches `expandFlex` — the global-keyword guard drops the whole declaration, so grow/shrink/basis are lost instead of resolving to `0 1 auto`. The `v === 'initial'` branch at `longhand.ts:187` is dead code. `longhand.test.ts:355` encodes the drop as correct, citing the prototype. AS-061 and AS-068 directly contradict each other here and the contract was never reconciled. Also `/^[\d.]+$/` rejects `1e2`/`+1`, misrouting them to basis. |
| AS-062 | PASS | Order-independent; both longhands emitted. |
| AS-063 | PASS | Four longhands with spec defaults `all/0s/ease/0s`. |
| AS-064 | PASS | `splitComma` is paren-aware; `cubic-bezier(...)` survives; per-item lists positionally aligned. Verified. |
| AS-065 | **FAIL (blocker)** | Three defects. (a) On failure it returns `{decls:{font: v}}` — **re-emits the shorthand verbatim** (`longhand.ts:324`), blessed by a test literally named `..._is_kept_as_shorthand_with_warning`. (b) The weight regex `^(bold\|bolder\|lighter\|normal\|[1-9]00)$` rejects CSS4 numeric weights: `font: 450 15px Inter` → `{font-size:"450", font-family:"15px Inter"}`. Weight 450 is mandated by this repo's own design system. (c) `small-caps` is consumed and silently discarded. |
| AS-066 | PASS (weak, minor) | type/position/image assigned; any unrecognised token overwrites `list-style-type` last-wins with no warning. |
| AS-067 | PASS (major caveat) | Same `var()`-as-width misclassification as AS-055. |
| AS-068 | PASS | Guard is case-insensitive, gated on `isShorthand`, covers `revert-layer`, returns empty decls + warning. |
| AS-069 | **FAIL (blocker)** | Six properties are in `SHORTHANDS` but have **no `case`** in `expandDeclaration`: `background`, `animation`, `grid`, `grid-gap`, `grid-template`, `grid-area`. They fall to `default: return {decls:{[p]:v}}` and are emitted **verbatim, with no warning**; `css.ts:156` does `Object.assign(bucket, decls)` with no post-filter, so they land straight in the class payload. Probe confirms `.c{background:#fff url(x) no-repeat}` yields `base:{background:"#fff url(x) no-repeat"}` and `warnings: []`. Add the `font` fallback and that is seven verbatim-shorthand paths. Webflow rejects these outright. The test named for AS-069 (`longhand.test.ts:816`) only checks dispatch of the *implemented* cases and never asserts the absence of shorthands in output. |
| AS-070 | PASS | `max-width:991px` → `medium`. |
| AS-071 | PASS | `max-width:767px` → `small`. |
| AS-072 | PASS | `max-width:479px` → `tiny`. |
| AS-073 | PASS | 1440/1920/2560 → `large`/`xl`/`xxl`. |
| AS-074 | PASS | No media query → `main`; `variantKey('main', null)` → null → base bucket. Note the test labelled `AS-074` is about `@media print` and the one labelled `AS-048` is about `variantKey('main')` — both mislabelled. |
| AS-075 | PASS | `background-image: url("/img/hero.jpg")` preserved byte-for-byte, quotes intact. |
| AS-076 | PASS (impl) / FAIL (traceability, major) | `background-size`/`-position` untouched, but the test labelled `AS-076` is the `@media print` test; AS-076 has no test of its own. |

## Blockers

**B1 — AS-069: six shorthands ship verbatim, silently.**
`isShorthand()` and `expandDeclaration()` have diverged with nothing keeping
them in sync. `background`, `animation`, `grid`, `grid-gap`, `grid-template`,
`grid-area` (plus the `font` fallback) reach the `default:` branch and are
copied into the class payload unchanged and unwarned. This is the single
assertion the whole module exists to guarantee, and it is false today for the
most commonly pasted shorthand in real-world CSS (`background`).

**B2 — AS-048: no max-width or min-width is ever unmappable.**
`BREAKPOINTS.maxWidth.find(b => px <= b.upTo)` falls back to `'medium'` and
the min-width path falls back to `'large'`. A designer's `@media (max-width:
1200px)` silently becomes Webflow's tablet breakpoint with no warning — a
wrong-output failure, not a skip. The test suite asserts the fallback as
intended behaviour.

**B3 — AS-040/AS-039: combo-class bucket and `comboOf` collision.**
`ensure()` keys one record per class name, so a class that appears both
standalone and as a combo target shares one declaration bucket and gets
`comboOf` retroactively stamped onto it. `.b{color:red} .a.b{color:blue}`
→ one class `b`, `base:{color:blue}`, `comboOf:"card"`-style linkage. The
standalone rule is destroyed and every element using `.b` alone is now
misrepresented as a combo. Order-dependent and untested. `comboOf: string |
null` is structurally too weak for CSS chains of depth > 2.

**B4 — AS-057 + nested-CSS leak.**
`expandBorderRadius` splits on `/` without paren awareness, corrupting any
`calc(a/b)` radius. Separately, `css.ts:150` uses `node.walkDecls`, which is
**recursive**: `.a{color:red; .b{color:blue}}` yields `a.base={color:blue}` and
`.z{color:green; &:hover{color:black}}` yields `z.base={color:black}` — the
parent's declaration is overwritten, the nested rule's declarations are
attributed to the wrong class and the wrong variant, and no warning is
emitted. Verified by probe. Should be a non-recursive iteration over direct
`decl` children.

## Majors

- **M-a — Mirror tests.** Three tests justify behaviour by reference to "the
  reference prototype" rather than to CSS or to the assertion, and each sits
  exactly where the implementation is wrong: `longhand.test.ts:355` (`flex:
  initial` drop), `:496` (`font` kept as shorthand), `:629` (`var()` as border
  width). `breakpoints.test.ts:27` does the same for B2. These tests would not
  fail if the behaviour they describe were corrected — they would fail if it
  *were* corrected. That inverts the purpose of the suite.
- **M-b — Assertion-ID mislabelling.** At least six test labels cite the wrong
  assertion: `css.test.ts:102` (AS-049), `:112` (AS-050), `:191` (AS-076);
  `breakpoints.test.ts:39` (AS-074), `:54` (AS-048). Conversely the real
  AS-049/AS-050/AS-042–045 parseCss behaviours are untagged. AS-135 and F039's
  coverage audit both depend on these labels; the suite currently *reads* as
  covering AS-046…AS-076 while AS-048 and AS-069 have no real coverage at all.
- **M-c — `var()`/`calc()` classified as a border/outline width** (AS-055,
  AS-067). Design-token CSS is the normal case in this repo.
- **M-d — AS-061 vs AS-068 contradiction** for `flex: initial`, unreconciled,
  with dead code left in `expandFlex`.
- **M-e — `font` weight regex rejects CSS4 numeric weights** (450/350/550),
  silently promoting the weight into `font-size`.
- **M-f — Empty class records.** Every non-terminal chain member (`a`, `b` in
  `.a.b.c`) is pushed into `order` with empty base and variants; downstream
  emitters will produce empty Webflow class definitions.

## Minors

- `.x::hover` (invalid double-colon) is accepted as the hover state.
- `list-style` unknown tokens last-wins into `list-style-type`, no warning.
- `isWidth` regex matches `1.2.3px` and bare `5`.
- `box([])` on an empty value yields `undefined` sides (currently masked by
  postcss never producing empty values).
- `>4` values on a box shorthand are silently truncated.
- `css.test.ts:75` asserts `STATE_ALIASES` deep-equals its own definition.

## Recommended follow-up features

**FU-M2-1 — Close the shorthand escape hatch (blocker, AS-069).** Make
`expandDeclaration`'s `default:` branch assert the invariant instead of
violating it: when `isShorthand(prop)` is true and no `case` matched, return
`{decls: {}, warning: '...'}` naming the property and telling the user to
write longhands, rather than emitting the declaration verbatim. Do the same
for the `font` fallback at `longhand.ts:324`. Then either implement real
expanders for `background`, `animation`, `grid-gap` (→ row-gap/column-gap),
`grid-template`, `grid-area`, `grid` — or remove them from `SHORTHANDS` and
accept that they are warned-and-dropped. Add a property-based test that runs
a corpus of real-world CSS through `parseCss` and asserts that
`isShorthand(k)` is false for every key `k` of every `base` and every variant
bucket in the result — a test that fails if the two sets diverge again.

**FU-M2-2 — Unmappable viewport widths must warn, not snap (blocker,
AS-048).** Change `mapBreakpoint` to return `null` when a `max-width` or
`min-width` value does not equal one of Webflow's exact viewport boundaries
(479/767/991 and 1440/1920/2560), rather than falling back to `medium` /
`large`. Decide deliberately whether near-misses snap with a warning or are
skipped outright — AS-048 says "produces a warning and its rules are skipped",
so skipping is the contract-conformant choice. Update
`breakpoints.test.ts:27` and `:35`, which currently assert the opposite, and
add parseCss-level cases proving `@media (max-width:1200px)` yields a warning
and zero classes.

**FU-M2-3 — Model combo classes as chains, not a single `comboOf` string
(blocker, AS-039/AS-040).** Key the class map by the full chain, not by the
terminal class name, so that `.b` and `.a.b` are distinct records that never
share a declaration bucket and never mutate each other's linkage. Represent
the chain as `string[]` so `.a.b.c` retains both ancestors, which the M4
payload emitter will need to satisfy AS-117 (`comb` registered as a child of
the base class). Add tests for: standalone-then-combo, combo-then-standalone
(order independence), three-deep chains, and the same class appearing under
two different bases.

**FU-M2-4 — Paren-aware and nesting-aware parsing (blocker, AS-057 +
silent declaration loss).** Replace the raw `value.split('/')` in
`expandBorderRadius` with a paren-aware split so `calc(100%/2)` survives, and
only emit the elliptical-flattening warning when a genuine top-level `/`
was found. Separately, replace `node.walkDecls` in `css.ts:150` with
iteration over the rule's *direct* declaration children, and either handle
nested rules (`&:hover`, nested class blocks) properly or emit a warning that
they are unsupported — today they silently overwrite the parent class's base
declarations and discard the parent's own styles.

**FU-M2-5 — Repair test-to-assertion traceability and de-mirror the suite
(major).** Audit every `it("AS-NNN: ...")` label in `lib/webflow-converter/`
against the verbatim assertion text and correct the six known mislabels; add
missing labelled tests for AS-042–045 at the parseCss level, AS-044
(combinators), AS-049, AS-050 and AS-076. Delete or invert the four tests that
assert prototype-parity rather than assertion intent. Add a lint-style check
that every assertion ID in the M2 range appears in at least one test name, so
F039's coverage audit has a sound basis.

**FU-M2-6 — Value tokenisation hardening (major).** Route `var()`/`calc()`
tokens in `border`/`outline` to the colour slot when a width-shaped token has
not been seen, or better, only treat a token as a width when it carries a
length unit or is a named width; widen the `font` weight regex to accept any
1–3 digit numeric weight (450/350/550 are mandated by this repo's design
system and currently become the `font-size`); preserve `small-caps` as
`font-variant` or warn that it was dropped; reconcile AS-061 and AS-068 for
`flex: initial` and remove the dead branch in `expandFlex`.

---

## Command output

### `npx vitest run lib/webflow-converter/`
```
 Test Files  4 passed (4)
      Tests  154 passed (154)
   Start at  19:15:48
   Duration  207ms
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
```
PASSTHRU background   isShorthand=true {"decls":{"background":"#fff url(a.png) no-repeat"}}
PASSTHRU animation    isShorthand=true {"decls":{"animation":"#fff url(a.png) no-repeat"}}
PASSTHRU grid         isShorthand=true {"decls":{"grid":"#fff url(a.png) no-repeat"}}
PASSTHRU grid-gap     isShorthand=true {"decls":{"grid-gap":"..."}}
PASSTHRU grid-template isShorthand=true {"decls":{"grid-template":"..."}}
PASSTHRU grid-area    isShorthand=true {"decls":{"grid-area":"..."}}

parseCss('@media (max-width:1200px){.a{color:red}} @media (min-width:600px){.b{color:blue}} .c{background:#fff url(x) no-repeat} .btn{color:red} .card.btn{color:blue}')
WARNINGS []
  a  -> variants.medium = {color:red}        <-- 1200px silently snapped to tablet
  b  -> variants.large  = {color:blue}       <-- 600px silently snapped to large
  c  -> base = {background:"#fff url(x) no-repeat"}   <-- shorthand in payload
  btn-> base = {color:blue}, comboOf="card"  <-- standalone .btn{color:red} destroyed
  card-> base = {}

border-radius | calc(100%/2) => four corners of "calc(100%" + bogus elliptical warning
font | 450 15px Inter        => {"font-size":"450","font-family":"15px Inter"}
border | solid var(--accent) => border-*-width: var(--accent)

parseCss('.a{color:red; .b{color:blue}} .z{color:green; &:hover{color:black}}')
  a -> base {color:blue}    <-- parent's own color:red lost
  z -> base {color:black}   <-- parent's color:green lost, hover variant lost
  warnings []
```
