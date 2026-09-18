# M3 Scrutiny — Round 10

**Verdict: FAIL — 3 blockers.**

Gates are green: `lib/webflow-converter` 385/385 tests pass, `tsc --noEmit`
clean, `npm run lint` clean. (The full repo run has 173 failures, all in
`tests/integration/**` from `fetch failed` against Supabase — network, not
M3.)

**Round-9 blocker: CLEARED.** The F092 name-uniqueness check is gone
(`f64b9a77` deleted `validator.ts:124-140` plus its two tests). Verified
empirically, not just by reading the diff: `.primary{} .btn{} .btn.primary{}`
with `<div class="btn primary">` + `<div class="primary">` now converts with
`errors: []` and emits three styles — standalone `primary` (`comb:""`),
`btn`, and combo `primary` (`comb:` btn's id). The `7c464cd2` css.ts change
does **not** drop the legitimate standalone: `ensure()` never overwrites an
existing record's null `comboOf` (`css.ts:121-129`), confirmed
order-independently including combo-first CSS.

But the underlying failure mode that F092 was chasing is still live in three
other places, and each turns ordinary real-world input into `payload: null`.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | PASS | No supabase/fetch/env reference anywhere in `lib/webflow-converter/*.ts`; guard test is weak (filename-substring scan) but the code is clean. |
| AS-041 | PASS | All 8 pseudo-states map to distinct Webflow slots; `emit.test.ts:214-341` asserts exact slot names + composite breakpoint+state keys. Mutation-resistant. |
| AS-051 | **FAIL — major** | Confirmed false positive: classes inside an `<svg>` (or any `SKIPPED_TAGS`) subtree are never collected, so `.icon-path` on `<path>` warns "defined but not used". Untested. |
| AS-069 | PASS | Independent sweep of the full `css-shorthand-properties` vocabulary × 6 value shapes × base/hover/before/2 media buckets: zero leaks. Documented exception: `background-position` passes through by design (`longhand.ts:371`). |
| AS-089 | **FAIL — major** | One malformed `<style>` block destroys the entire merged stylesheet. `convert.ts:49` joins all CSS sources into one string; `css.ts:106-110` returns an empty class map on `CssSyntaxError`. `<div class="good">x</div><style>.bad{color:</style>` + `.good{color:red}` → `payload: null`. Same for the legacy `<style><!-- ... --></style>` form. |
| AS-091 | PASS | `emit.ts:231-235,258-260`; uppercase `ID=`, duplicate ids, id on img/a/svg all verified. Minor: `id=""` silently dropped. |
| AS-101 | PASS | Mixed inline + external + nested + JS-tab probe returns one ordered array. |
| AS-103 | PASS | `js-extract.ts:38-43` emits `outerHTML` verbatim, no allowlist; `js-extract.test.ts:64-87` asserts byte-exact round-trip incl. `async defer type=module integrity crossorigin` — kills a re-serializing mutant. |
| AS-110 | PASS | `js-extract.test.ts:33-39` asserts an exact ordered array; deeper-nesting and uppercase `<SCRIPT>` probes preserve document order. |
| AS-111 | PASS (tainted) | Validator check `validator.ts:175-177` is properly falsified by `validator.test.ts:181-202`. The `convert()`-level test is a mirror: the literal is spread from `emit.ts:308` and asserted back. |
| AS-112 | PASS | `validator.ts:187-189`; `convert("","")` and script-only input both return null payload with `payload.nodes must not be empty`. |
| AS-114 | **FAIL — blocker** | The rule is enforced by *rejecting the document* rather than by emitting a resolvable payload. Any class in the HTML with no CSS rule kills the conversion: `<div class="wrapper w-container">` + `.wrapper{color:red}` → `payload: null`, error `references class "w-container" with no matching style definition`. Webflow's own utility classes (`w-container`, `w-inline-block`), `js-*` hooks and state classes are ubiquitous in pasted markup. The tests codify the bad behaviour. |
| AS-116 | PASS | `_id` uniqueness at `validator.ts:114-118`, tested at `validator.test.ts:245-259`. A parallel reviewer argued `name` is the "real" identifier and marked this FAIL; I reject that reading — round 9 established that combo styles legitimately share a terminal name and are disambiguated by `comb`. Enforcing name-uniqueness is exactly the regression F093 reverted. Do not re-add it. |
| AS-117 | **FAIL — blocker** | Two defects, one a literal violation. (1) Dangling `comb`: `emit.ts:171-184` skips a combo with a missing base but leaves its `_id` in `idByKey` (`emit.ts:119-121`), so a deeper combo points at a dropped id. `.a{} .a.b.c{} .a.b.c.d{}` → `Combo style "c5ce28d5…" references unknown base "5a0bcfa7…"`, payload null. (2) The skip path itself is a product-level failure, not a graceful degrade: `.a{} .a.b.c{}` + `<div class="a b c">` → payload null. `.a.b.c{}` without a separate `.a.b{}` rule is normal authoring. `emit.test.ts:192` asserts the local skip and mirrors the implementation; there is no `convert()`-level test of this path. |
| AS-118 | INCONCLUSIVE | `convert.ts:92-100` does null the payload on any error, and that is tested. But there is no copy consumer in the codebase yet — `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` is a static placeholder and nothing imports `convert`. The "user sees an error instead" half is unverifiable until M6. Worse, the blockers above mean it currently fires on valid input. |
| AS-119 | INCONCLUSIVE | Same missing consumer. The three AS-119 tests restate `errors.length > 0 ⇒ valid === false` — the literal definition at `validator.ts:194` / `convert.ts:92`. Tautological; cannot fail except by deliberate inversion. |
| AS-141 | PASS | `convert.test.ts:227-336` asserts exact flattened node count, combo wiring in both directions, `variants.hover`, two distinct breakpoint slots, and a no-shorthand sweep over base and variant `styleLess`. Genuinely falsifiable. |

## Blockers

**B1 — AS-117: stale `idByKey` entry produces a dangling `comb`.**
`emit.ts:119-121` registers an id for every chain key including ones the
second pass later skips at `emit.ts:171-184`. Severity: blocker.

**B2 — AS-117/AS-114: a missing intermediate combo link aborts the whole
conversion.** Skipping the combo leaves the node carrying a class with no
style, which AS-114 then converts into a fatal error. Severity: blocker.

**B3 — AS-114: unstyled classes are fatal.** A class on an element with no
corresponding CSS rule should produce a bare style stub (or be dropped with a
warning), not null the payload. Severity: blocker. This is the same shape of
defect as the round-9 blocker: a validity rule enforced by rejection instead
of by construction.

## Majors

**M1 — AS-051 false positive inside skipped subtrees** (`emit.ts:274` returns
early for `svg → HtmlEmbed` without walking children).

**M2 — AS-089 single bad `<style>` block discards all CSS** (`convert.ts:49`
+ `css.ts:106-110`).

**M3 — `walkNodes` silent skips.** `validator.ts:56` returns when `children`
is a non-array object, and `validator.ts:83` skips the class check when
`classes` is a string — both return `valid: true` on malformed input. No
tests.

**M4 — `<script>` nested in `<svg>` is double-emitted**: kept verbatim inside
the HtmlEmbed's `data.html` (`emit.ts:274`) *and* extracted into
`customCode.scripts` (`js-extract.ts:35`). Executes twice on paste.

## Minors

- AS-011 guard test (`convert.test.ts:338-383`) only scans files whose
  *filename* contains "webflow"; the actual route file is `page.tsx` in a
  `webflow/` directory and is never scanned.
- Dead branch: `!RESERVED_ATTRS.has(name)` in `buildXattr` (`emit.ts:220`)
  can never fire.
- `id=""` is dropped by the truthiness check at `emit.ts:258`.
- AS-111/AS-119 convert-level tests are mirrors; they should assert against a
  deliberately corrupted payload instead.

## Recommended follow-up features

**FU-A — emit stub styles for unreferenced classes (AS-114, blocker).**
In `emit.ts`, after the node walk, collect every class name that appears on
any node but has no corresponding entry in the style array, and emit a
minimal style record for each (`name` = the class, `styleLess: ""`,
`comb: ""`, empty `variants`/`children`, `fake: false`). This makes AS-114
true by construction rather than by rejection, and preserves the class on the
element so the user can style it in the Designer. Add a `convert()`-level
test asserting `<div class="wrapper w-container">` with only `.wrapper`
defined produces a non-null payload containing a `w-container` style, and a
test that the stub does *not* trigger an AS-051 warning (the class is used,
it just has no CSS). Do not add a warning for this case — unstyled utility
classes are normal.

**FU-B — repair combo chains with missing intermediate links (AS-117,
blocker).** In `emit.ts`, when a combo's base key is absent, synthesise an
empty base style for the missing intermediate chain member (e.g. `.a.b` for
`.a.b.c`) instead of skipping, chaining it under its own base so the whole
chain is well-formed. If synthesis is genuinely impossible, delete the
skipped style's key from `idByKey` (`emit.ts:119-121`) so no descendant can
resolve `comb` to a dropped id. Tests: a 4-level chain with a missing
intermediate (`.a{} .a.b.c{} .a.b.c.d{}`) must produce a non-null payload
whose every `comb` resolves and whose every combo appears in its base's
`children`; and a `convert()`-level test for `.a{} .a.b.c{}` with
`<div class="a b c">`.

**FU-C — per-source CSS parsing so one bad block degrades gracefully
(AS-089, major).** Change `convert.ts:49` to parse the `css` argument and
each extracted `<style>` block separately and merge the resulting class maps,
rather than string-joining then parsing once. A `CssSyntaxError` in one
source becomes a warning naming that source and the remaining sources still
contribute styles. Tests: valid external CSS survives a malformed inline
`<style>`; the legacy `<style><!-- ... --></style>` comment-wrapped form
either parses or degrades to a warning without nulling the payload.

**FU-D — walk into skipped-tag subtrees for class usage (AS-051, major).**
`emit.ts:274` returns the HtmlEmbed without descending. Collect class names
from the raw subtree (or have `convert.ts` scan the original HTML for class
attributes rather than only the emitted node tree) so a class used only
inside an `<svg>` is not reported as unused. Test with
`<svg class="icon"><path class="icon-path"/></svg>`.

**FU-E — close the validator's silent-skip holes (major).** At
`validator.ts:56` push an error when `children` is present but not an array;
at `validator.ts:83` push an error when `classes` is present but not an
array. Tests must construct both malformed shapes and assert `valid: false`.

**FU-F — de-duplicate scripts nested in raw-HTML embeds (major).** Either
strip `<script>` from the HtmlEmbed's `data.html` in `emit.ts:274`, or have
`js-extract.ts:35` exclude scripts inside `svg`/embed subtrees. Test that
`<svg><script>x()</script></svg>` yields the script exactly once across
`data.html` + `customCode.scripts`.

**FU-G — make AS-011/AS-111/AS-119 tests falsifiable (minor).** Widen the
AS-011 guard to scan by directory path, not filename substring. Replace the
AS-111 and AS-119 convert-level mirrors with tests that feed a deliberately
corrupted payload into `validatePayload` and assert the error, rather than
asserting an emitter literal back at itself.

---

## Gate output

```
$ npx vitest run lib/webflow-converter
 Test Files  9 passed (9)
      Tests  385 passed (385)
   Duration  483ms

$ npx tsc --noEmit
(no output — clean)

$ npm run lint
> pm-app@0.1.0 lint
> eslint
(no output — clean)

$ npx vitest run            # full repo, for the record
 Test Files  252 failed | 488 passed | 1 skipped (741)
      Tests  173 failed | 3556 passed | 1687 skipped (5416)
# every failure is `Error: Failed to create test workspace: TypeError: fetch failed`
# in tests/integration/** — Supabase network access, unrelated to M3.
```

## Empirical probes (run against f64b9a77, no files modified)

```
convert('<div class="btn primary">x</div><div class="primary">y</div>',
        '.primary{color:red}.btn{color:blue}.btn.primary{color:green}')
  → errors: []   styles: primary(comb:"") , btn(children:[combo]) , primary(comb:btn)
     # round-9 blocker cleared

convert('<div class="a b c d">x</div>', '.a{}.a.b.c{}.a.b.c.d{}')
  → payload: null, 'Combo style "c5ce28d5…" references unknown base "5a0bcfa7…"'   # B1

convert('<div class="a b c">x</div>', '.a{}.a.b.c{}')
  → payload: null, 'Node … references class "c" with no matching style definition' # B2

convert('<div class="wrapper w-container">x</div>', '.wrapper{color:red}')
  → payload: null, 'Node … references class "w-container" with no matching style'  # B3

convert('<div class="icon-wrap"><svg class="icon"><path class="icon-path"/></svg></div>',
        '.icon-wrap{}.icon{}.icon-path{}')
  → warning: 'CSS class "icon-path" is defined but not used by any HTML element'   # M1

convert('<div class="good">x</div><style>.bad{color:</style>', '.good{color:red}')
  → payload: null, warning 'CSS parse error: Unclosed block'                        # M2
```
