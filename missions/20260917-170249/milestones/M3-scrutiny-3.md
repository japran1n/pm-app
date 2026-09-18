# M3 scrutiny — round 3 — HTML / emit / validate engine (F015–F021, F075–F085)

**Result: FAIL** — 3 blockers (down from 6). All three sit on `emit.ts`.

Read-only review. `git status` clean for `lib/`. Findings come from reading the
code, three independent parallel reviewers given only assertion text + file
lists (no handoff, no worker reasoning), and live `convert()` probes.

Suite, lint and typecheck are green: **362/362**, `tsc` exit 0, `eslint` exit 0.

## What round 3 genuinely fixed

Four of round 2's six blockers are **really** fixed, verified by probe, not by
reading the diff:

- **AS-112** — `convert("","")` now returns `errors: ["payload.nodes must not be empty"]`, `payload: null`. `allowEmptyNodes` is gone from `validator.ts`; `validatePayload` now takes no options object at all.
- **AS-114** — `fakeStyles` is gone. `convert('<div class="ghost"></div>', "")` → `payload: null`. Depth-1 and depth-3 unresolved classes behave identically. `validator.ts:48-95` recurses unconditionally.
- **AS-051** — `convert.ts:53-71` walks the full tree and tracks *per-node* class lists, so combo chains only count as used when one element carries the whole chain. The round-2 false-positive probe now returns `warnings: []`.
- **AS-117** — `emit.ts:164` keys the base lookup on the composite `"a|b"`. Probe on `.a{} .a.b{} .a.b.c{}`: `.a.b.c`'s `comb` points at the `.a.b` combo, and `.a.b.children` contains it. `emit.test.ts:142-161` asserts `comboABC.comb).not.toBe(standaloneB._id)` — a real regression guard, not a mirror.

Two escape-hatch greps (`anyway|force|override|skipValidation|allowInvalid|bypass`) across `lib/webflow-converter`, `app`, `components` return only comments.

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | PASS | `convert.test.ts:296-304` scans every non-test source file for "supabase". `page.tsx` is a static server component with no imports. Minor: the test scans the module dir, not the page. |
| AS-041 | **FAIL (blocker B-1, B-2)** | 5 of the 8 contractually-named pseudo-states are discarded, and `emit.test.ts:209-251` asserts the discard as correct. Breakpoint+state folding clobbers order-dependently. |
| AS-051 | PASS (major R-1) | Recursion + per-node chain matching correct; mutation probe confirms `convert.test.ts:293` catches removal of the recursion. Gap: removing the *combo-chain* branch fails no test. |
| AS-069 | PASS (major R-2) | Probe over 13 shorthands across base, `:hover`, breakpoint, folded breakpoint+state and combo: zero leaks. Guarantee lives entirely in `longhand.ts:554-566`; `emit.test.ts` has no AS-069 coverage, and the new string-concat fold is the one place in `emit.ts` where a leak could originate. |
| AS-089 | PASS | `convert.ts:36-41`; `emit.ts:69` keeps `script`/`style` out of `nodes`. Probed at top level and nested inside a `<div>`. |
| AS-091 | **FAIL (blocker B-3)** | `emit.ts:241` reads `attrs.id` case-sensitively. `<div ID="Hero">` → `data: {}`, id silently dropped, no warning, no error. |
| AS-101 | PASS (major R-3) | `js-extract.ts:35-53`. Hole: a `<script>` inside `<noscript>` is dropped entirely — probe returns `scripts: []`, `warnings: []`. The "JS-tab input" half still has no implementation (M4+). |
| AS-103 | **FAIL (major R-4)** | Implementation is genuinely verbatim (`el.outerHTML`, `:41`), but **a mutant that re-serializes `<script src="X"></script>` — dropping `async`/`defer`/`type="module"`/`integrity`/`crossorigin` — passes the entire suite 11/11.** All three fixtures use the one shape where `outerHTML` and naive re-serialization coincide. Test mirrors implementation; per the scrutiny standard this is FAILED. Behaviour met → severity major, not blocker. |
| AS-110 | PASS | `js-extract.test.ts:33-39` interleaves inline/external/inline and asserts full array equality. Real guard. |
| AS-111 | PASS | `emit.ts:291` literal; `convert.ts:77-80` threads it; `validator.ts:175-177` enforces. |
| AS-112 | PASS | Fixed. See above. |
| AS-114 | PASS | Fixed. See above. Recursion verified by mutation (removing it breaks `convert.test.ts:52`). |
| AS-116 | PASS (major R-5) | `validator.ts:114-118` on `_id`; 601-id probe unique. Style **names** still duplicate (standalone `b` + combo `b`), which is the identifier Webflow resolves on paste. Outside the assertion's wording. |
| AS-117 | PASS | Fixed. See above. |
| AS-118 | PASS (engine scope) | `convert.ts:82-90` returns `payload: null` on any `!validation.valid`, no override argument. AS-111–AS-117 now all hold at the engine, so no violating payload is returned as a success. UI copy surface deferred to M4–M6 per mission scope. |
| AS-119 | PASS (major R-6) | No escape hatch exists. But `convert.test.ts:141-158` remains the round-1 tautology (`if (errors.length) expect(null) else expect(not null)`) — neither branch can fail. AS-119 has no real `convert()`-level test. |
| AS-141 | PASS | `convert.test.ts:185-294` — 6 nodes, combo both directions, hover, `medium` + `tiny`, type envelope, shorthand sweep, zero errors. Now also asserts `warnings`, which is what closed round 2's B-2. |

---

## Blockers

### B-1 — Five of the eight pseudo-states AS-041 names are discarded, and the new tests codify the loss. [AS-041]
`lib/webflow-converter/emit.ts:76-81`, `lib/webflow-converter/emit.test.ts:209-251`

```ts
const PSEUDO_STATE_TO_WEBFLOW: Record<string, string> = {
  hover: "hover", focus: "focused", pressed: "pressed", active: "pressed",
};
```

The round-2 fix removed `placeholder: "nthChild"` — correct, the slot was wrong
— but did not replace it. `css.ts:12-21` parses all eight states; five now fall
into the `else` at `emit.ts:151-153` and are dropped with a warning. Probe, one
selector per run:

```
:hover          -> {"hover":...}     ok
:active         -> {"pressed":...}   ok
:focus          -> {"focused":...}   ok
:focus-visible  -> {}  warn+dropped
:visited        -> {}  warn+dropped
::placeholder   -> {}  warn+dropped
::before        -> {}  warn+dropped
::after         -> {}  warn+dropped
```

AS-041 says these states "are converted into the corresponding state variant."
Worse than the code: `emit.test.ts:220-251` now asserts
`expect(Object.keys(style.variants)).toHaveLength(0)` for `:visited`,
`::placeholder`, `::before` and `::after`. **The suite now asserts the exact
inverse of an immutable contract assertion.** A future correct implementation
would turn these tests red. That is a regression in test integrity relative to
round 2, where the states were merely unimplemented.

Webflow's clipboard schema does have `before`/`after` pseudo-element slots and
link-state slots; "no Webflow slot exists" is an assumption the code asserts
without evidence. If the limitation is real for some subset, it needs a **new**
assertion ID recording it — AS-041 cannot be narrowed.

### B-2 — Breakpoint+state folding loses declarations order-dependently, while warning that it preserved them. [AS-041]
`lib/webflow-converter/emit.ts:126-146`

The fold writes into `variants[breakpointPrefix].styleLess`. But a plain
breakpoint key hits the direct-assign branch at `emit.ts:119-123`, which
**overwrites** rather than merges. Whether data survives depends on
`Object.keys(rec.variants)` insertion order:

```
css: .btn{color:red}
     @media(max-width:991px){.btn:hover{color:green}}
     @media(max-width:991px){.btn{background-color:pink}}
-> variants: {"medium":{"styleLess":"background-color: pink;"}}
-> warnings: [":hover inside @media blocks is not supported ... declarations
              moved to breakpoint styles (variant \"medium_hover\" on .btn)"]
```

`color: green` is gone, and the warning states the opposite. `emit.test.ts:253+`
exercises only the lucky ordering.

Even in the lucky ordering the fold is wrong. Probe:

```
.btn{color:#000}.btn:hover{color:red}
@media(max-width:991px){.btn{color:green}.btn:hover{color:blue}}
-> medium.styleLess = "color: green; color: blue;"
```

Two `color` declarations in one styleLess (last-wins, so tablet renders blue
unconditionally) and a **hover-only** style applied permanently at that
breakpoint. This is not "nothing is lost" — it is a visual behaviour change
applied silently. The fold concatenates styleLess *strings*; it must merge the
declaration *objects* before stringifying, and a hover declaration must not
land in an unconditional slot at all.

### B-3 — `id` is dropped when the attribute is not lowercase. [AS-091]
`lib/webflow-converter/emit.ts:241`

```ts
if (attrs.id) { xattr.unshift({ name: "id", value: attrs.id }); }
```

`node-html-parser` preserves attribute case. Probe:

```
convert('<div ID="Hero" CLASS="a">x</div>', '.a{color:red}')
-> node: {"tag":"div","classes":[],"data":{}}     errors: []
```

The `id` is gone **and** `classes` is empty. `<div ID=...>` is valid HTML and
appears in real pasted markup; nothing warns. The same lowercase assumption
affects `attrs.class` (`:236`), `attrs.style` (`:221`), the `data-` prefix
filter (`:209`) and `RESERVED_ATTRS` (`:73`) — an uppercase `CLASS` silently
strips every class from a node, which will then also produce spurious AS-051
"unused class" warnings for CSS that is in fact used.

`emit.test.ts:72-76` uses lowercase only and would not fail.

---

## Non-blocking recommendations

**R-1 — AS-051's combo-chain branch is unguarded.** Mutation probe: replace the
per-node chain matching at `convert.ts:64-67` with the flat `usedClasses` set
and **no test fails**. The subtlest part of the logic is free to rot. Add
`convert('<div class="btn"></div><div class="mod"></div>', '.btn{}.mod{}.btn.mod{}')`
must warn on `btn|mod`, and the same two classes on one element must not.

**R-2 — AS-069 has no emit-layer test.** Protection is entirely in
`longhand.test.ts`. The new string-concat fold (`emit.ts:138-143`) is the only
point in `emit.ts` where two independently-validated declaration sets are joined
as text; it is the plausible origin of a future leak and is unasserted. Also
still open from round 2: `PASS_THROUGH` (`longhand.ts:370-377`) emits
`background-position` and `background-size` verbatim, both of which have
longhands under CSS.

**R-3 — `<script>` inside `<noscript>` vanishes with no signal.**
`<noscript><script src="/ns.js"></script></noscript>` → `scripts: []`,
`warnings: []`. `noscript` is a raw-text element to the parser, and `noscript`
is also in `emit.ts:69`'s `SKIPPED_TAGS`, so the script is in neither output.
Literally an AS-101/AS-103 violation; scored major because the input is rare.

**R-4 — AS-103's verbatim guarantee has zero effective coverage.** A
re-serializing mutant passes 11/11. Add a fixture asserting byte-identical carry
of
`<script async defer type="module" integrity="sha384-abc" crossorigin="anonymous" src="/a.js"></script>`,
plus single-quoted, unquoted and uppercase-tag variants. Real behaviour was
probed correct on all of these — the risk is purely regression exposure.

**R-5 — Duplicate style *names* (carried from round 2, R-7).** `.a{} .b{} .a.b{}`
emits two styles named `b` (standalone and combo) with different `_id`s, plus a
phantom empty `d` when `.c.d` has no standalone `.d`. AS-116 is about
identifiers and does not fire, but Webflow resolves by name on paste. Needs a
decision and probably a new assertion.

**R-6 — The AS-119 tautology survives three rounds.** `convert.test.ts:141-158`
cannot fail in either branch. Deliberately-broken inputs exist and behave
correctly today (illegal Webflow class name, unresolved class, empty document) —
they are simply never asserted at `convert()` level.

**R-7 — AS-114 depth coverage is depth-1 only.** `convert.test.ts:52` would pass
against a mutant that recursed exactly one level. Depth-3 behaviour is correct
(probed); add the case.

**R-8 — AS-011's test scans `lib/webflow-converter`, not the converter page.**
The assertion is about the page. Extend the scan to `page.tsx` and any future
`components/webflow-tool/*`.

**R-9 — Other untested js-extract loss paths (carried from round 2, R-5).**
`</script>` inside a string literal truncates and discards the tail;
self-closing `<script src="/a.js"/>` reparents following siblings into custom
code; `<template>`-nested scripts are hoisted into executing custom code;
`<script src="">` with no body is dropped silently. None warned, none tested.

**R-10 — `scripts[]` still mixes two representations** (bare JS bodies vs. full
tag markup). Settle this before M4 writes a consumer.

**R-11 — `validator.ts:83`:** when `payload.styles` is not an array,
`styleNames` is `null` and every AS-114 check is silently skipped. `valid` is
still `false`, so AS-118 holds, but the error list is misleadingly short.

**R-12 — `convert.ts:77-80`** validates a synthesized `{...payload.payload, type}`
object while returning `emitResult.payload`. Equivalent today; they can drift if
`emit` ever adds an envelope field.

---

## Recommended follow-up features

**FU-A — Implement all eight AS-041 pseudo-states against Webflow's real
clipboard schema.** In `lib/webflow-converter/emit.ts`, extend
`WebflowStyleVariants` and `PSEUDO_STATE_TO_WEBFLOW` so that `:focus-visible`,
`:visited`, `::placeholder`, `::before` and `::after` each reach a state slot.
The slot names must be established from Webflow's actual clipboard JSON — copy a
real element carrying each state out of the Designer and read the payload —
rather than inferred, which is how `placeholder: "nthChild"` got in. Delete the
five tests at `emit.test.ts:220-251` that currently assert these states produce
*no* variant: they assert the inverse of an immutable contract assertion and
will block any correct implementation. Replace each with a test asserting the
correct slot and its `styleLess`. If, after checking the real schema, a specific
state genuinely has no representable slot, that limitation is recorded as a
**new** assertion ID together with an explicit user-facing warning — AS-041 is
never narrowed. Covers AS-041.

**FU-B — Merge breakpoint and breakpoint+state declarations as objects, and stop
leaking hover into unconditional slots.** In `emit.ts:113-154`, accumulate each
breakpoint's declarations into a single `Record<string,string>` across all
contributing variant keys and stringify once at the end, so the direct-assign
branch can no longer clobber a fold (or vice versa) depending on
`Object.keys` order. Separately, a `:hover` rule inside `@media` must not be
written into the breakpoint's unconditional `styleLess` — that applies hover
styling permanently at that breakpoint. Either target a per-breakpoint state
slot if one exists in the real schema, or drop the declarations with an honest
warning; the current warning claims preservation that does not happen. Add a
test for each of the two `@media` rule orderings, a test asserting no duplicate
property appears in any `styleLess`, and a test asserting a breakpoint-scoped
hover never appears in the breakpoint base. Covers AS-041, AS-069.

**FU-C — Normalise attribute lookup to be case-insensitive throughout emit.**
`node-html-parser` preserves source attribute case, but HTML attribute names are
case-insensitive. Build a lowercased attribute map once per element in
`walkElement` and drive every lookup from it — `id` (`emit.ts:241`), `class`
(`:236`), `style` (`:221`), `type` (`:219`), the `data-` prefix filter (`:209`)
and `RESERVED_ATTRS` (`:73`) — plus the `attrs` object handed to
`getWebflowType`. Today `<div ID="Hero" CLASS="a">` loses both its id and all
its classes with no warning, and then produces a spurious AS-051 "unused class"
warning for CSS that is actually used. Add tests for uppercase and mixed-case
`ID`, `CLASS`, `STYLE`, `HREF` and `DATA-FOO`. Covers AS-091.

**FU-D — Make the custom-code tests adversarial and close the silent-loss
paths.** Add a `js-extract` fixture asserting byte-identical carry-through of an
external script tag bearing `async`, `defer`, `type="module"`, `integrity` and
`crossorigin`, plus single-quoted, unquoted and uppercase-tag variants, so that a
re-serializing regression cannot pass green (it currently would, 11/11). Then
handle the loss paths: warn when a `<script>` inside `<noscript>` or
`<template>` is encountered and decide whether to hoist it; warn when a script's
raw text terminates mid-token because `</script>` appeared inside a string
literal; warn on self-closing `<script src="..."/>`, which reparents every
following sibling into the custom-code output. Finally, settle `scripts[]` on a
single representation — raw bodies or tag markup, not both — before M4 writes a
consumer. Covers AS-101, AS-103, AS-110.

**FU-E — Close the remaining test-sensitivity gaps at `convert()` level.**
Replace the `convert.test.ts:141-158` tautology with tests that feed genuinely
invalid input (an illegal Webflow class name, an unresolved class, an empty
document) and assert `payload === null` plus the specific error, unconditionally.
Add an AS-051 test for the combo-chain branch (removing it currently fails no
test), an AS-114 test at depth 3, an AS-069 assertion at the emit layer, and an
AS-116 name-uniqueness decision + test. Extend the AS-011 source scan to cover
the converter page and its components, not just `lib/webflow-converter`. Covers
AS-011, AS-051, AS-069, AS-114, AS-116, AS-119.

---

## Command output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  362 passed (362)
   Start at  23:00:09
   Duration  479ms (transform 280ms, setup 402ms, import 322ms, tests 83ms, environment 0ms)
```

### `npx tsc --noEmit`

```
(no output — exit 0)
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no output — exit 0)
```

### Live probes of `convert()`

```
-- AS041 pseudo-states (one selector per run, .btn) --
:hover          {"hover":{"styleLess":"color: red;"}}
:active         {"pressed":{"styleLess":"color: red;"}}
:focus          {"focused":{"styleLess":"color: red;"}}
:focus-visible  {}  warn 'variant "main_focus-visible" ... does not map to a Webflow state — skipped'
:visited        {}  warn 'variant "main_visited" ... skipped'
::placeholder   {}  warn 'variant "main_placeholder" ... skipped'
::before        {}  warn 'variant "main_before" ... skipped'
::after         {}  warn 'variant "main_after" ... skipped'

-- AS041 fold, lucky order --
.btn{color:#000}.btn:hover{color:red}@media(max-width:991px){.btn{color:green}.btn:hover{color:blue}}
-> {"hover":{"styleLess":"color: red;"},"medium":{"styleLess":"color: green; color: blue;"}}
   (duplicate `color`; hover style applied unconditionally at medium)

-- AS041 fold, unlucky order (B-2) --
.btn{color:red}@media(max-width:991px){.btn:hover{color:green}}@media(max-width:991px){.btn{background-color:pink}}
-> {"medium":{"styleLess":"background-color: pink;"}}
   warn ':hover inside @media blocks ... declarations moved to breakpoint styles'  <-- false

-- AS112 --
convert("","")  -> errors ["payload.nodes must not be empty"]  payload null

-- AS114 --
convert('<div class="ghost"></div>',"")  -> errors ['Node ... references class "ghost" with no matching style definition']  payload null
convert('<div class="outer"><p class="ghost">x</p></div>','.outer{color:red}')  -> same error, payload null
depth-3 ghost -> same error, payload null

-- AS051 nested --
convert('<section class="hero"><div class="container"><h1 class="hero-title">Hi</h1></div></section>',
        '.hero{display:flex}.container{max-width:1200px}.hero-title{color:#111}')
-> warnings []   errors []

-- AS117 3-level  <div class="a b c">  .a{} .a.b{} .a.b.c{} --
a  id 2423  comb ""    children [9dec]
b  id 3d08  comb ""    children []        <- standalone .b (phantom)
b  id 9dec  comb 2423  children [d62d]    <- .a.b, correct parent of .a.b.c
c  id aa77  comb ""    children []        <- standalone .c (phantom)
c  id d62d  comb 9dec  children []        <- .a.b.c, correct
errors []

-- AS091 uppercase (B-3) --
convert('<div ID="Hero" CLASS="a">x</div>','.a{color:red}')
-> node {"tag":"div","classes":[],"data":{}}   errors []

-- AS101 noscript (R-3) --
convert('<noscript><script src="/ns.js"></script></noscript><div class="a">x</div>','.a{color:red}')
-> customCode {"scripts":[]}   warnings []

-- AS103 mutant test (R-4) --
mutant: scripts.push(`<script src="${src}"></script>`) instead of el.outerHTML
-> js-extract suite 11/11 PASS
-> drops async / defer / type="module" / integrity / crossorigin undetected
```

### AS-118 consumer scan

```
$ grep -rn "webflow-converter" --include='*.ts' --include='*.tsx' app components lib hooks tests | grep -v '^lib/webflow-converter/'
tests/unit/f004-webflow-tool-portal-isolation.test.ts:117
tests/unit/f004-webflow-tool-portal-isolation.test.ts:118
```

Still no caller of `convert()`. Per M3 scope this is expected — the copy surface
lands in M4–M6 and AS-118 is scored on the engine-level guarantee only.
