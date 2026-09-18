# M3 Scrutiny — Round 6

Milestone: **M3 — Conversion engine: HTML / emit / validate**
Mission: `20260917-170249`
HEAD at review: `f36a4566`
Reviewer: scrutiny validator (read-only; no code, test, or contract modified)

## Verdict: **FAIL** — 1 blocker

Both blockers carried from round 5 (B-2 / AS-103, B-3 / AS-041) are
**independently confirmed fixed**. One new blocker is raised against AS-101
that five prior rounds did not examine: the engine has no input channel for
the JS tab at all.

Gate check: tests 381/381 pass, `tsc --noEmit` clean, `eslint` clean.
Green on all three, and that is precisely the problem — the surviving
mutants below are all green too.

---

## Assertion table

| ID | Verdict | Reason |
|----|---------|--------|
| AS-011 | **FAIL** (major) | Page scan is *empty*, not merely weak — zero files match the filter; the real converter page is never scanned. |
| AS-041 | **PASS** (major caveat) | Composite key now correct; composite path tested for only 1 of 6 tiers and 3 of 9 states. |
| AS-051 | PASS (minor) | `@media`-only classes correctly not flagged unused; compound selectors yield cosmetic false positives. |
| AS-069 | **FAIL** (major) | Expansion is structurally correct but no test places a shorthand inside a pseudo-state rule; bypass mutant survives. |
| AS-089 | PASS (minor) | `SKIPPED_TAGS` enforced and tested at emit level; convert-level AS-089 tests assert routing only, not node absence. |
| AS-091 | PASS | `id` unshifted into `xattr`; killed by lowercase and uppercase-attribute tests. |
| AS-101 | **FAIL** (**blocker**) | `convert(html, css)` has no JS-tab parameter. The "combined HTML + JS-tab input" half of the assertion is unimplemented and untested. |
| AS-103 | **PASS** | Confirmed fixed. Exact whole-string equality (`toBe(input)`) on multi-attribute and `data-*` fixtures. |
| AS-110 | PASS | Discriminating inline/external/inline fixture; kills the two-list-concatenation mutant. |
| AS-111 | PASS | Strict `!==` against `@webflow/XscpData`; fail-closed; killed by missing- and wrong-type tests. |
| AS-112 | PASS | Non-array and empty-array both error; killed at validator and convert level. |
| AS-114 | **FAIL** (major) | Fail-open: `Array.isArray(node.classes)` guard means an absent/null/string `classes` field skips resolution silently. |
| AS-116 | **FAIL** (major) | Duplicate style `_id` is caught; duplicate style **`name`** — the identifier nodes actually reference — is never checked. |
| AS-117 | PASS (minor) | Combo parentage verified both directions; a falsy `comb` silently downgrades a combo to a base class with only a warning. |
| AS-118 | PASS at engine level (major) | `convert()` returns `payload: null` on any validation error. UI enforcement unverifiable — see scope note. |
| AS-119 | PASS at engine level (major) | `valid` is derived, not settable; no force/override parameter anywhere. UI enforcement unverifiable — see scope note. |
| AS-141 | PASS (minor) | Fixture verified to contain every required element; assertions on node types and exact style count are missing. |

---

## Blocker

### B-1 / AS-101 — the engine cannot receive JS-tab input (blocker)

`lib/webflow-converter/convert.ts:35`

```ts
export function convert(html: string, css: string): ConvertResult
```

AS-101 reads: *"All `<script>` content in the **combined HTML + JS-tab
input** (inline bodies and external `src` tags alike) is collected into a
single custom-code output."* There is no third parameter, no `js` field on
any options object, and no caller anywhere in `app/` or `components/` that
combines a JS tab with the HTML. `plan.md:111` states that after M3
"`convert()` is complete" — it is not complete for this assertion. No test
exercises a JS-tab path because no such path exists.

This may be an architecture-intent mismatch rather than an oversight: if the
intent is that the UI wraps the JS tab in `<script>…</script>` and appends it
to the HTML before calling `convert()`, then `extractScripts` would pick it
up and the assertion is satisfiable. But that intent is written down nowhere,
is enforced by nothing, and is tested by nothing — so as the code stands the
assertion is not met. Either resolution is cheap; both need a test.

Secondary, independently verified: a surviving orchestrator mutant. Adding
`.filter(s => !s.startsWith("<script"))` at `convert.ts:73-75` drops every
external script at the orchestrator and **the entire suite stays green**,
because no convert-level test ever passes an external `src` through.

---

## Confirmed fixes from round 5

**B-3 / AS-041 — composite key.** `emit.ts:150` now reads
`` `${breakpointPrefix}_${webflowKey.replace(/^main_/, "")}` ``. Verified the
full chain for `@media(max-width:991px) .btn:visited` resolves to
`medium_visited`. `emit.test.ts:309` and `:322` explicitly assert
`medium_main_visited` / `medium_main_placeholder` are `undefined`, so
reverting the `replace` fails two tests. Genuinely mutation-killed.

Caveat (not a blocker): the fix is a regex hack over a table that conflates
two concepts — a main-breakpoint slot name (`main_visited`) and a compositing
suffix (`visited`). `focus` → `focused` and `focus-visible` →
`focused-visible` are **not** stripped, producing `medium_focused` and
`medium_focused-visible`, spellings asserted nowhere. Two maps would be
correct where one map plus a `replace` is merely currently-correct.

**B-2 / AS-103 — multi-attribute scripts.** `js-extract.test.ts:64-71` uses
exact whole-string equality, not per-attribute `toContain`:

```ts
expect(result.scripts[0]).toBe(input);
```

This is the strong form. A re-serializing mutant that reorders attributes,
normalizes `async` → `async=""`, or drops `integrity`/`crossorigin` is
killed. Confirmed fixed.

---

## Majors

**M-1 / AS-011 — the page scan matches zero files.** `convert.test.ts:357`
filters on `entry.name.toLowerCase().includes("webflow")`, where `entry` is a
*file*. The converter page is `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx`
— the **directory** is named `webflow`, the file is `page.tsx`. I enumerated
the matches directly: **zero files**. The loop at `:369` iterates an empty
array. Proof it is skipped rather than passing: that page.tsx contains the
word "Supabase" in its header comments, so it would *fail* the test if it
were scanned. Adding `createClient()` to the converter page would not be
caught. Fix: match on the full path, not the basename.

**M-2 / AS-069 — shorthand-in-state-variant is untested.** `css.ts:177-186`
selects the bucket first and then runs `expandDeclaration` on every
declaration, so the implementation is uniformly correct. But the only AS-069
sweep over emitted output (`convert.test.ts:290-318`) uses a fixture whose
only shorthand sits inside `@media`, never inside a pseudo-state rule. This
mutant at `css.ts:182` passes the whole suite:

```ts
const { decls, warning } = variantKey?.includes("_")
  ? { decls: { [child.prop]: child.value }, warning: undefined }
  : expandDeclaration(child.prop, child.value);
```

`border: 1px solid red` on `.btn:hover` would ship raw into a variant slot
and Webflow would reject the paste.

**M-3 / AS-041 — composite path covered for one tier, three states.** Every
composite assertion in `emit.test.ts` uses `max-width: 991px`. `tiny`,
`small`, `large`, `xl`, `xxl` composites are never asserted at emit level;
`breakpoints.test.ts:166-171` covers all six tiers but only for the
*intermediate* key, before the slot mapping. This mutant survives:

```ts
const compositeKey = breakpointPrefix === "medium"
  ? `${breakpointPrefix}_${webflowKey.replace(/^main_/, "")}`
  : webflowKey;
```

It collapses `small:hover` into the plain `hover` slot, silently clobbering
the desktop hover style. Likewise `pressed`, `focused`, `focused-visible`,
`before`, `after` are never composited in any test.

**M-4 / AS-114 — validator fails open on `classes`.** `validator.ts:83`
guards with `if (styleNames && Array.isArray(node.classes))`. A node with no
`classes` key, `classes: null`, or `classes: "hero"` (a string — the natural
bug if someone forgets `.split()`) skips class resolution entirely and
validates clean. Every other field in the same function is duck-typed
(`typeof node._id !== "string"`); this one is the exception. No test kills
it — every test node comes from a `makeNode()` helper that always supplies an
array.

**M-5 / AS-116 — duplicate class *names* are not detected.**
`validator.ts:114` catches duplicate `_id`. But node `classes` entries
reference the style **`name`**, and two styles `{_id:"a",name:"hero"}` /
`{_id:"b",name:"hero"}` validate clean while collapsing to one entry in
`styleNames`. If "identifier" in AS-116 means the identity Webflow dedupes on,
this is a direct miss. No test kills it.

**M-6 / AS-101 — `<noscript>` silently swallows scripts.** Independently
verified by probe (probe file removed; working tree unmodified):

```
extractScripts('<noscript><script src="/ns.js"></script></noscript>')
  → { scripts: [] }
```

`node-html-parser` does not descend into `noscript`, *and* `noscript` is in
`SKIPPED_TAGS`, so the script is lost from **both** outputs with no warning.
Silent data loss against an assertion whose first word is "All".

**M-7 / AS-118 & AS-119 — scope note, not a defect.** The converter page is
still a 39-line placeholder: no editor, no convert button, no copy button, no
`navigator.clipboard` call, no import from `lib/webflow-converter`. Both
assertions are met at engine level and the lib is genuinely fail-closed
(`valid: errors.length === 0`, no override parameter). But "never offered for
copy" and "no escape hatch" are UI properties, and per `plan.md:97-112` M3 is
engine-only. **These two assertions must be re-validated at the UI milestone
and must not be treated as discharged by this round.**

---

## Minors

- `ExtractStylesResult.warnings` is dead code — always `[]`
  (`js-extract.ts:64,81`), spread for nothing at `convert.ts:43`.
- `convert.test.ts:202-215` is named "de-duplicates warnings" but does not
  test de-duplication; replacing the `Set` at `convert.ts:43` with an array
  survives it.
- AS-103: a `.toLowerCase()` mutant on the carried tag survives, because every
  character of both exact-equality fixtures is already lowercase. SRI hashes
  are mixed-case base64.
- AS-103: the single-quoted fixture (`js-extract.test.ts:80-87`) uses weak
  `toContain`; a quote-normalizing mutant survives it.
- AS-141: `toBeGreaterThanOrEqual(7)` where the comment says 8; node types and
  `href` are never asserted.
- `<template>` is inconsistent: a script inside it is promoted to custom code,
  yet `template` is not in `SKIPPED_TAGS`, so it also emits a node.
- Any element carrying a class with no matching CSS rule makes the whole
  conversion return `payload: null`. Fail-closed and correct per AS-114, but
  likely to read as "the converter is broken" on real-world paste input.

---

## Recommended follow-up features

**FU-1 — Accept JS-tab input in the conversion engine (blocker fix).**
Extend the engine's entry point so JS-tab content is a first-class input
rather than something a hypothetical caller is expected to splice into the
HTML string. Give `convert()` a third parameter (or an options object with an
`js` field), route its content through the same `extractScripts` collection
that HTML `<script>` elements use, and guarantee ordering is deterministic and
documented — HTML scripts first, then JS-tab content, or whatever the mission
intends, but written down. Add tests that pass JS-tab content alongside HTML
containing both inline and external scripts and assert the single
`customCode.scripts` output contains all of them in the specified order. Add
one convert-level test that passes an external `<script src>` end-to-end and
asserts it reaches `customCode.scripts`, closing the surviving orchestrator
filter mutant.

**FU-2 — Parameterized composite variant-key coverage.** Add a table-driven
test over all six breakpoint tiers crossed with all nine pseudo-states,
asserting the exact emitted variant key for each of the 54 combinations.
This kills the per-tier special-case mutant and pins down the currently
unasserted `focused` / `focused-visible` / `before` / `after` composite
spellings. While there, consider splitting `PSEUDO_STATE_TO_WEBFLOW` into two
explicit maps — state-to-main-slot and state-to-composite-suffix — so the
`main_` regex strip disappears.

**FU-3 — Shorthand expansion coverage inside state and combined variants.**
Add fixtures placing genuine shorthands (`border`, `padding`, `font`,
`transition`) inside a bare pseudo-state rule and inside a combined
`@media` + pseudo-state rule, then assert no shorthand property name appears
in any emitted `styleLess` across base and every variant slot. This closes
the `css.ts:182` bucket-bypass mutant that the current AS-069 sweep cannot see.

**FU-4 — Harden the validator against malformed shapes.** Make the `classes`
field fail closed: a node whose `classes` is present but not an array should
be an error, not a skipped check, matching how `_id` and `type` are already
duck-typed. Add duplicate style **name** detection alongside the existing
duplicate `_id` check, since node class references resolve by name. Flag a
style that carries a falsy-but-present `comb` as an error rather than
silently reclassifying it as a base class. Add tests for each malformed
shape.

**FU-5 — Make the AS-011 Supabase scan actually scan.** Change the file
filter from basename matching to full-path matching so
`app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` is covered, and
broaden detection beyond a raw `"supabase"` substring to catch imports
re-exported through a local module. Note that fixing the filter will
immediately fail on the current page's comments, so the check should target
imports and call expressions rather than prose. Add a deliberate negative
fixture proving the scan fails when a Supabase call is introduced.

**FU-6 — Handle `<noscript>` and `<template>` script content explicitly.**
Decide and implement the intended behaviour for scripts the HTML parser does
not descend into. At minimum, emit a warning rather than silently discarding
a `<script>` inside `<noscript>`, and resolve the `<template>` inconsistency
where its scripts are promoted to custom code while the template itself still
emits a node. Add tests for both containers.

---

## Full tool output

### `npx vitest run lib/webflow-converter/`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  381 passed (381)
   Start at  23:39:05
   Duration  584ms (transform 354ms, setup 606ms, import 396ms, tests 99ms, environment 1ms)
```

### `npx tsc --noEmit`

```
(no output — clean)
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no findings)
```

---

## Notes on method

No code, test, or contract file was modified. Two temporary probe test files
were created inside `lib/webflow-converter/` to empirically confirm the
`<noscript>` script-loss finding and were deleted in the same command;
`git status --porcelain` confirms no tracked file under `lib/` is dirty.

Three parallel reviewers were given only assertion text and file lists — no
handoff, no worker reasoning, no prior scrutiny reports.
