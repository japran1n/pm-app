# M3 Scrutiny — Round 7

Milestone: **M3 — Conversion engine: HTML / emit / validate**
Mission: `20260917-170249`
HEAD at review: `ee86ef67`
Reviewer: scrutiny validator (read-only; no code, test, or contract modified)

## Verdict: **FAIL** — 1 blocker, 7 majors

The three blockers carried from rounds 5 and 6 are **independently confirmed
fixed and mutation-killed**. AS-041, AS-103 and AS-101 are genuinely closed.

However, this round found a **new blocker that is not a test weakness but a
live behavioural violation**: on ordinary combo-class input, `convert()`
emits a payload containing two style definitions with the same `name` and
reports `errors: []` — i.e. an invalid payload is offered for copy. This was
reproduced against the real code, not inferred. It violates AS-116 and
therefore AS-118.

Rounds 1-6 all missed it because the only combo fixture in the suite
(`.btn.btn--primary`) happens to give the base and the combo different
names. The collision appears whenever a combo's terminal class is *also* a
class in its own right — which is the common case, and which the emitter
itself synthesizes.

Gates are green and prove nothing: `vitest` 384/384, `tsc --noEmit` clean,
`eslint` clean. Every mutant listed below is green too.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|----|---------|----------|--------|
| AS-011 | **FAIL** | major | Page scan matches **zero** files — filter tests the *filename* for "webflow", but the real page is `webflow/page.tsx`. |
| AS-041 | **PASS** | — | All 8 states end-to-end plus breakpoint composites; double-prefix mutant now kills 2 tests. |
| AS-051 | **FAIL** | major | Warning is produced, but no near-miss fixture; a prefix-matching mutant silences it undetected. |
| AS-069 | **FAIL** | major | Two independent surviving mutants; invariant is asserted only in one fixture, never enforced by the validator. |
| AS-089 | **FAIL** | major | Only the "no node" half is tested, and only for *nested* elements; top-level `<script>`/`<style>` is unguarded. |
| AS-091 | **FAIL** | major | All four id tests use *top-level* elements; dropping ids on nested elements keeps the suite green. |
| AS-101 | **PASS** | — | Orchestrator filter mutant now killed; `result.customCode.scripts` confirmed as the correct path. |
| AS-103 | **PASS** | — | `el.outerHTML` verbatim; attribute-stripping mutant kills 4 tests. |
| AS-110 | PASS | minor | Discriminating inline/external/inline fixture kills list-concatenation reordering. |
| AS-111 | **FAIL** | major | Comparison exactness never pinned; a case-insensitive mutant accepts `@WEBFLOW/XSCPDATA`. |
| AS-112 | **PASS** | — | Empty-array, null, and non-object-entry all error. No weakening found. |
| AS-114 | **FAIL** | major | Double fail-open; `classes: "ghost"` (string) validates clean, and every AS-114 test uses exactly one class. |
| AS-116 | **FAIL** | **blocker** | Duplicate style **`name`** never checked — and the emitter really produces one on ordinary input. |
| AS-117 | **FAIL** | major | Self-referential combo validates clean; a combo whose base has no style is emitted un-parented and skipped by the validator. |
| AS-118 | **FAIL** | **blocker** | Inherited from AS-116: an invalid payload *is* offered for copy, with `errors: []`. |
| AS-119 | **FAIL** | major | No escape hatch exists, but nothing pins that; an `allowInvalid` option can be added with the suite green. |
| AS-141 | **PASS** | — | Genuine end-to-end test asserting behaviour: node count, combo cross-check, hover + two breakpoint variants, no-shorthand sweep. |

---

## Blocker

### B-1 / AS-116 + AS-118 — duplicate style `name` on ordinary combo input

**Reproduced against unmodified HEAD `ee86ef67`.** Input:

```ts
convert('<div class="btn primary">x</div>', '.btn.primary{color:red}')
```

Output (`errors` and `styles` verbatim):

```json
{
 "errors": [],
 "styles": [
  { "_id": "e6f0144e…", "name": "btn",     "comb": "",         "children": ["6da679fd…"] },
  { "_id": "b393d9b4…", "name": "primary", "comb": "",         "children": [] },
  { "_id": "6da679fd…", "name": "primary", "comb": "e6f0144e…", "children": [] }
 ],
 "nodeClasses": [["btn", "primary"]]
}
```

Two distinct style definitions are both named `primary`. The node carries
`classes: ["btn", "primary"]`, and **nodes reference styles by `name`, not
by `_id`** — `validator.ts:45` states this explicitly, and the resolution
code at `validator.ts:85` matches against the name set. So `"primary"` is an
ambiguous reference to two different definitions, and `errors` is empty, so
`convert()` returns a non-null payload that the copy action would happily
offer.

AS-116 reads: *"No two style definitions in the same payload share the same
identifier."* The identifier that matters here is `name`. `validator.ts:114`
dedupes only `_id`; `style.name` is merely accumulated into a `Set` at
`validator.ts:119-121`, where collisions are silently swallowed by Set
semantics and never reported.

The root cause is in the emitter, not only the validator: `css.ts:172`
registers every member of a selector chain as a standalone class
(`for (const c of chain) ensure(c, c, null)`) *in addition to* the combo
entry keyed `btn|primary`, whose `name` is also the terminal class
`primary`. Both reach the styles array.

Why six rounds missed it: the sole combo fixture is `.btn.btn--primary`
(`convert.test.ts:234`), where the base is `btn` and the combo's terminal
class is `btn--primary` — different names, no collision. Any combo whose
terminal class is also used on its own collides. AS-141 mandates combo
classes in the milestone's acceptance fixture, so this is squarely in scope.

**This is a blocker, not a major**, because the assertion is violated by the
running code on realistic input — not merely under-tested.

---

## Majors — surviving mutants

All mutants below were applied to unmodified HEAD, run, and reverted; the
suite stayed **384/384 green** in every case.

### M-1 / AS-089 — top-level `<script>`/`<style>` can emit a visible node
`emit.ts:224` → `if (SKIPPED_TAGS.has(tag) && (el.parentNode as HTMLElement | null)?.tagName) return null;`
The fragment root has a null `tagName`, so a top-level `<style>`/`<script>` —
the most common real snippet shape — now emits a node, exactly what AS-089
forbids. `convert.test.ts:85` feeds a top-level `<style>` but never asserts
node count, so nothing dies. Related, unguarded: `<style media="print">` is
merged as if unconditional (`js-extract.ts:63-79`), and a `<style>` whose CSS
fails to parse silently vanishes with only a generic warning.

### M-2 / AS-091 — ids on nested elements can be dropped silently
`emit.ts:255` → `if (attrs.id && !(el.parentNode as HTMLElement | null)?.tagName)`
All four id tests (`emit.test.ts:60, 72, 96` + uppercase variant) use
top-level elements, so dropping every nested id goes unnoticed. Also
uncovered: `id=""` is falsy and dropped without warning.

### M-3 / AS-114 — fail-open class resolution
`validator.ts:83` → `if (styleNames && Array.isArray(node.classes) && node.classes.length < 2)`
disables resolution for every node with two or more classes — i.e. every
combo element, the case AS-114 matters most for. Confirmed directly:
`classes: "ghost"` (a string, not an array) yields `valid: true`, zero errors.
Every existing AS-114 test uses a node with exactly one class.

### M-4 / AS-117 — structurally broken combos validate clean
Two holes needing no source edit: (a) a self-referential combo
`{_id:"x", name:"x", comb:"x", children:["x"]}` validates clean
(`validator.ts:144`); (b) when a combo's base has no style definition,
`emit.ts:170-180` leaves `comb: ""` and emits the combo un-parented with only
a warning, and the validator's `if (style.comb)` guard then skips it — a
combo that is *not* a child of its base is accepted verbatim.

### M-5 / AS-069 — two independent surviving mutants
(a) `css.ts:187`, bypass `expandDeclaration` when `state` is truthy: green.
The AS-141 no-shorthand sweep *does* iterate `style.variants`
(`convert.test.ts:316-318`), but no fixture ever places a shorthand in a
pseudo-state rule — the only state declaration anywhere is
`background-color`, already a longhand.
(b) `longhand.ts:26`, narrow the vendor-prefix strip from
`/^-(?:webkit|moz|ms|o)-/` to `/^-(?:webkit)-/`: `-ms-flex: 1`,
`-moz-transition: all 1s`, `-o-border-radius: 4px` then bypass
`isVendorShorthand` and land verbatim in `styleLess`. The vendor test at
`longhand.test.ts:1290` uses only `-webkit-`.
Underlying issue: `validator.ts` contains no shorthand check at all, so the
whole invariant rests on one fail-open `default:` branch at
`longhand.ts:550-563` that emits `{[p]: v}` for anything unrecognised.

### M-6 / AS-111 — comparison exactness not pinned
`validator.ts:175`, mutate to
`String(payload.type).toLowerCase() !== EXPECTED_TYPE.toLowerCase()`: green.
`type: "@WEBFLOW/XSCPDATA"` then validates as a Webflow payload. Both
existing tests only feed `undefined` and a wholly different string.

### M-7 / AS-119 — no contract pins the absence of an escape hatch
`convert.ts:45` add `opts?: { allowInvalid?: boolean }` and change
`convert.ts:92` to `if (!validation.valid && !opts?.allowInvalid)`: green.
A fully functional copy-anyway override ships undetected. The validator test
at `validator.test.ts:167` is tautological — it restates
`valid === (errors.length === 0)` rather than testing the intent.

### M-8 / AS-011 — the page scan matches zero files (unchanged from round 6)
`convert.test.ts:342-370` filters with
`entry.name.toLowerCase().includes("webflow")`. Executed standalone against
the real tree this returns **0 matched files**: the converter page is
`app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` — "webflow" is the
*directory*, the file is `page.tsx`. Sharpening this matters: that page does
contain "supabase" once, in a comment at line 24 stating the page makes no
Supabase query, so a naive corrected scan would immediately go red on a
comment.

### M-9 / AS-051 — near-miss class names untested
`convert.ts:77`, loosen to
`usedClasses.has(parsed.name) || nodeClassLists.flat().some((c) => c.startsWith(parsed.name))`: green.
`.btn` defined with only `class="btn-large"` present then produces no
warning. (Verified positive: `@media`-only and `:hover`-only classes are
correctly *not* flagged unused.)

---

## Minor

- `emit.ts:86` — `active: "pressed"` in `PSEUDO_STATE_TO_WEBFLOW` is dead
  code; `css.ts` `STATE_ALIASES` already rewrites `active` → `pressed`, so
  deleting the key leaves 384 green. Harmless, but it obscures which module
  owns the alias.
- `convert.test.ts:304` — `assertNoShorthand` early-returns on a falsy
  `styleLess`, so an empty emitted style passes vacuously.

---

## Confirmed fixes from prior rounds — verified by mutation, not inspection

| Prior blocker | Mutant applied | Suite result | Outcome |
|---|---|---|---|
| B-3 / AS-041 (round 5) | drop `.replace(/^main_/,"")` at `emit.ts:150` | 2 failed / 382 passed | **killed** |
| B-2 / AS-103 (round 5) | re-serialise external script, dropping attrs, at `js-extract.ts:41` | 4 failed / 380 passed | **killed** |
| B-1 / AS-101 (round 6) | `.filter(s => !s.startsWith("<script"))` at `convert.ts:84` | 2 failed / 382 passed | **killed** |

**AS-101 path confirmed.** `result.customCode.scripts` is correct:
`ConvertResult.customCode` is declared `{ scripts: string[] }` at
`convert.ts:20-22` and populated at `convert.ts:83-85`. The three new tests at
`convert.test.ts:375-410` drive `convert()` rather than `extractScripts()`
directly, so the orchestrator seam is genuinely covered for the first time.

**AS-101 scope decision — accepted.** The "JS-tab input" half was resolved by
documentation (`convert.ts:35-43`: the M5 UI wraps JS-tab content in
`<script>` tags and appends to `html`) rather than a parameter. That is a
legitimate choice of the two options round 6 offered, and it is now written
down where it previously was not. It stays unenforced at the engine boundary;
see FU-5.

---

## Recommended follow-up features

**FU-1 — Make style `name` unique and validate it (blocker fix).** Two halves.
In `validator.ts:104-122`, add duplicate detection on `style.name` alongside
the existing `_id` check, pushing an error when two entries share a name,
since `name` is the identifier nodes resolve against. In the emitter, stop
producing the collision: `css.ts:172` registers every chain member as a
standalone class while the combo entry keyed `btn|primary` also carries
`name: "primary"`, so `.btn.primary` yields two styles named `primary`. Decide
a single naming rule for combo entries and apply it consistently, then confirm
`convert('<div class="btn primary">x</div>', '.btn.primary{color:red}')`
produces either one `primary` style or two distinctly-named ones. Add
regression tests for a combo whose terminal class is also used standalone, and
for a directly-constructed payload with two same-named styles asserting
`valid === false`.

**FU-2 — Close the validator fail-opens (AS-114, AS-117).** Replace the
`Array.isArray(node.classes)` guard at `validator.ts:83` with an explicit
branch that errors when `classes` is present but not an array, errors on
non-string entries, and still resolves when it is an array — a malformed
`classes` field must not validate clean. At `validator.ts:144`, reject
`style.comb === style._id` (self-referential combo), and error when a style is
a combo by construction yet has `comb === ""`; correspondingly, `emit.ts:170-180`
should raise an error rather than a warning when a combo's base has no style
definition. Tests: `classes: "hero"` as a string, `classes: null`, a
self-referential combo, and a combo whose base is missing — all asserting
`valid === false`.

**FU-3 — Enforce the AS-069 no-shorthand invariant in the validator, not just
in one fixture.** Add a payload-level check to `validatePayload` that walks
every style's `styleLess` and every `variants[*].styleLess`, and errors if any
property name is a known shorthand — so the invariant is enforced rather than
hoped for. Then add the two missing fixture cases: a shorthand inside a
pseudo-state rule (e.g. `.btn:hover { padding: 8px 16px; border: 1px solid #000 }`,
plus a `@media` + `:hover` combination), and vendor-prefixed shorthands using
`-ms-`, `-moz-` and `-o-` rather than only `-webkit-`. Verify by applying both
mutants (`css.ts:187` state bypass, `longhand.ts:26` prefix narrowing) and
confirming each now goes red.

**FU-4 — Harden the emit-level structural tests (AS-089, AS-091).** Every
current id test and the `SKIPPED_TAGS` test use top-level elements, leaving the
nested and root cases mutually unguarded. Add: a top-level `<script>` and
top-level `<style>` in a fragment, asserting the emitted node count excludes
them and that their content appears in `customCode.scripts` / the style model
respectively; and an `id` on a nested element, plus an `id` on an `<a>` and an
`<img>` where `typeInfo.data` is non-empty and `data.xattr` is assigned after
the spread at `emit.ts:252-258`. Also decide and test the behaviour for
`id=""`, for `<style media="print">`, and for a `<style>` whose CSS fails to
parse (currently the element is removed and the content silently dropped).

**FU-5 — Pin the AS-111 and AS-119 contracts.** For AS-111, add a test feeding
a case-variant type string (`"@WEBFLOW/XSCPDATA"`) and a leading/trailing
whitespace variant, asserting both are invalid, so the comparison's exactness
is pinned. For AS-119, replace the tautological test at `validator.test.ts:167`
with contract assertions: that `convert.length === 2` (no options parameter
exists), and that across a table of invalid inputs `payload === null` holds
exactly when `errors.length > 0`. Additionally, once the M5 converter UI lands,
add a boundary test feeding a non-empty JS tab alongside HTML containing its
own inline and external scripts, asserting `result.customCode.scripts` contains
all of them in source order with the JS-tab content present exactly once —
converting the documented AS-101 convention into a checked one.

**FU-6 — Repair the AS-011 Supabase scan so it is non-vacuous.** The recursive
walk in `convert.test.ts` filters candidates by filename substring and
therefore matches nothing, because the converter route is a directory named
`webflow` containing `page.tsx`. Match the *full path* for a `webflow` path
segment, and assert the scan found at least one file
(`expect(webflowFiles.length).toBeGreaterThan(0)`) so it can never silently
degrade to vacuity again. Because the page legitimately contains the word
"supabase" in an explanatory comment, replace the raw `toContain` with an
import-level check — no line matching `/^\s*import .* from ["'].*supabase/m`
and no `createClient(` call. This is the third round in which this test has
been vacuous; the match-count guard is the part that prevents a fourth.

---

## Scope notes

- **AS-118 / AS-119 UI half.** Both assertions speak of "the copy action" and
  "offered for copy". No copy UI exists at M3 — it is M5 scope, and a grep
  found no consumer of this module. AS-118 nonetheless fails *at engine level*
  this round, because the blocker above means `convert()` returns a non-null
  invalid payload. The blocking mechanism itself (`convert.ts:92-100`, which
  returns `payload: null` unconditionally on `!validation.valid`) is sound;
  it is only as strong as the validator feeding it. The UI half must be
  re-validated at M5 and is not discharged here.

---

## Full gate output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  384 passed (384)
   Start at  23:49:05
   Duration  488ms (transform 314ms, setup 404ms, import 338ms, tests 89ms, environment 0ms)

[exited with code 0]
```

Pre-existing and unrelated to M3 — Vite config loader warning: ESM syntax in
`vitest.config.ts` and `tests/realtime-live-delivery-tests.ts` loaded as
CommonJS.

### `npx tsc --noEmit`

```
[no output — exited with code 0]
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

[no output — exited with code 0]
```

### Repo state

All mutants and probe files were reverted/removed.
`git status --porcelain lib/` is empty and HEAD is unchanged at `ee86ef67`.
