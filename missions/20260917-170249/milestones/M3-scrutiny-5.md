# M3 Scrutiny — Round 5 (HTML / emit / validate engine)

Mission: 20260917-170249
Date: 2026-09-17
Method: 3 parallel adversarial reviewers (code + assertions only, no handoff),
plus independent mutation probes by the lead validator.

## Result: **FAIL**

Two blockers. `npx vitest run lib/webflow-converter/` is green (376/376),
`npx tsc --noEmit` is clean, `npm run lint` is clean — but green tests are not
the bar. Two assertions have surviving mutants or objectively wrong output.

---

## What was fixed — F088 / commit `f0cbe618`

**B-1 (AS-041) from round 4 is genuinely resolved at the main breakpoint.**
Confirmed by individual mutation testing, not by reading the handoff. Every
pseudo-state slot is killed by its own dedicated test:

| Mutation applied to `emit.ts` | Killed by |
|---|---|
| drop `"focus-visible"` (:84) | `emit.test.ts:238`, `:278` |
| drop `visited` (:89) | `emit.test.ts:262` |
| drop `placeholder` (:90) | `emit.test.ts:270` |
| drop `before` / `after` (:87-88) | `emit.test.ts:246` / `:254` |
| drop `focus` (:83) | `emit.test.ts:230`, `:278` |
| drop `pressed` (:85) | `emit.test.ts:222` |
| misname `main_visited` → `visited` | `emit.test.ts:262` |
| misname `main_placeholder` → `placeholder` | `emit.test.ts:270` |
| misname `focused-visible` → `focusedVisible` | `emit.test.ts:238`, `:278` |
| composite key → breakpoint-only (:150) | `emit.test.ts:288`, `:301`, `:332` |

All eight AS-041 pseudo-states are present in `PSEUDO_STATE_TO_WEBFLOW`
(`emit.ts:81-91`). The round-4 blocker is closed.

**However, the same commit introduced a new defect in the composite-key path
(B-3 below).** The fix is correct for 6 of 8 states and wrong for the other 2.

Also confirmed resolved since earlier rounds: AS-117 three-level combo chains
(3 independent mutations killed), AS-051 unused-class recursion (positive +
negative cases), AS-112/AS-114 escape hatches removed (mutating them kills
5 and 6 tests respectively).

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | **FAIL** (major) | Page/component scan is vacuous — filename filter matches 0 files. |
| AS-041 | **FAIL** (blocker) | Breakpoint + `:visited`/`::placeholder` emits malformed `medium_main_visited`. |
| AS-051 | PASS | Positive + negative + depth-3 descendant cases; `convert.test.ts:107-111`, `:130`, `:325`. |
| AS-069 | **FAIL** (major) | Mutant skipping shorthand expansion *only in state variants* survives the whole suite. |
| AS-089 | PASS | Removing `script`/`style` from `SKIPPED_TAGS` (`emit.ts:74`) kills a dedicated test. |
| AS-091 | PASS | Dropping or reordering the `id` passthrough (`emit.ts:255-257`) is killed; case-insensitivity covered. |
| AS-101 | INCONCLUSIVE (major) | HTML half covered; the "JS-tab input" half has no implementation — `convert(html, css)` takes no JS argument. |
| AS-103 | **FAIL** (blocker) | Re-serializing mutant that drops `defer`/`async`/`integrity`/`type=module` passes all 376 tests. |
| AS-110 | PASS | Reversing the `scripts` array kills 3 tests; order pinned by `toEqual` on ordered arrays. |
| AS-111 | PASS | Deleting the `payload.type` error push kills 2 tests; envelope verified to emit `@webflow/XscpData`. |
| AS-112 | PASS | Removing the empty-nodes error kills 5 tests. |
| AS-114 | PASS | Gating off class-resolution kills 6 tests. |
| AS-116 | PASS (major caveat) | Killed only *indirectly* via the validator; `emit.test.ts` has no uniqueness assertion. |
| AS-117 | PASS (strong) | 3 independent mutations all killed; missing-base warning path covered. |
| AS-118 | INCONCLUSIVE (major) | Library half solid (`convert.ts:82-90`, mutating kills 8 tests); no converter UI exists to gate. |
| AS-119 | PASS (major caveat) | No override parameter exists anywhere — but trivially true because no copy UI exists yet. |
| AS-141 | PASS | Fixture at `convert.test.ts:217-326` genuinely contains all seven listed elements, each asserted. |

---

## Blockers

### B-3 (AS-041) — composite breakpoint+state keys are malformed for `:visited` and `::placeholder`

`PSEUDO_STATE_TO_WEBFLOW` stores `visited → "main_visited"` and
`placeholder → "main_placeholder"` (`emit.ts:89-90`), i.e. the `main_`
breakpoint prefix is baked into the *value*. The composite branch at
`emit.ts:150` then prefixes it a second time:

```ts
const compositeKey = `${breakpointPrefix}_${webflowKey}`;
```

Verified empirically against the real module:

```
input:    @media (max-width:991px){ .a:visited{...} .a::placeholder{...}
                                    .a:focus-visible{...} .a:hover{...} }
css.ts:   ["medium_visited","medium_placeholder","medium_focus-visible","medium_hover"]
emit.ts:  ["medium_main_visited","medium_main_placeholder","medium_focused-visible","medium_hover"]
warnings: []
```

`medium_main_visited` and `medium_main_placeholder` are not Webflow variant
keys. Webflow silently discards unrecognised variant slots on paste, so the
user loses those declarations with **no warning and no validation error** —
the exact failure mode that made B-1 a blocker in round 4. This is a
regression introduced by the B-1 fix itself.

No test covers it: `emit.test.ts` exercises only `medium_hover` (lines 295,
314, 343). The two states whose map values carry a `main_` prefix are tested
only at the main breakpoint (`:262`, `:270`).

Severity: blocker — AS-041 says the pseudo-state "is converted into the
corresponding state variant"; for these two states at any non-main breakpoint
it is converted into a non-corresponding, invalid one.

### B-2 (AS-103) — external `<script src>` verbatim carry is still unasserted (third round carrying)

Mutation applied at `js-extract.ts:41`, replacing

```ts
scripts.push(el.outerHTML);
```

with a re-serialization built from the parsed `src` alone
(`<script src="${src}"></script>`), discarding `defer`, `async`,
`type="module"`, `integrity`, `crossorigin`, every `data-*`, and the original
quoting/attribute order.

**Result: 375 passed / 1 failed — byte-identical to baseline. No test noticed.**

Cause: all three external-script fixtures (`js-extract.test.ts:13`, `:23`,
`:34`) are bare `<script src="...">` with no second attribute, so
re-serialization is indistinguishable from verbatim carry. The clause "with
no stripping" is completely unverified.

This was raised as M-1 in round 3 and again in round 4. It is now a blocker:
three rounds is enough notice, and the failure is silent user-facing data
loss (a `defer`/`module` script pasted into Webflow without those attributes
executes with different semantics).

---

## Majors (do not block on their own, but all are real)

**M-2 (AS-069) — shorthand expansion unverified inside state variants.**
End-to-end coverage lives in exactly one place: the inline `SHORTHANDS` scan
at `convert.test.ts:290-318`, embedded inside the AS-141 test. Its fixture
places a shorthand in the base and in a *breakpoint* variant, but never in a
state variant — the only state rule is `:hover { background-color }`, already
a longhand. Mutant: skip `expandDeclaration` (`css.ts:182`) only when
`variantKey` contains `_`. **Survived the entire suite.** The breakpoint-only
equivalent is killed, so the gap is specific and narrow. Behaviour is correct
today (verified: `.a:hover{padding:3px 4px}` → four longhands), hence major
not blocker. Secondary fragility: the guarantee rests on a hardcoded 11-item
array inside an unrelated integration test, and `validator.ts` performs **no
shorthand check at all** (`grep styleLess validator.ts` → only a type check at
`:140`).

**M-3 (AS-011) — page scan is vacuous (carried from round 4, not fixed).**
`convert.test.ts:353` keeps a file only when
`entry.name.toLowerCase().includes("webflow")` — a *basename* filter. The
converter route is
`app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx`: "webflow" is a
*directory* segment. Shell-verified: `find app components -type f \( -name
'*.ts' -o -name '*.tsx' \) ! -name '*.test.ts*'` filtered on basename →
**0 files**. The loop at `:369-372` asserts nothing and cannot ever fail.
Part 1 of the test (the 16 `lib/webflow-converter/*.ts` files) is a genuine
guard; part 2 is decoration. Note the naive fix would immediately fail: the
page contains the literal string "supabase" in a comment at line 24, so the
check must target imports/calls (`@/lib/supabase`, `.from(`), not a substring.

**M-4 (AS-116) — uniqueness only covered indirectly.** Forcing every style id
to a constant is killed, but only through `validator.ts:111` reached via
`convert.test.ts`. `emit.test.ts` contains no uniqueness assertion, and
`validator.test.ts:245` tests hand-built payloads, not emit output. If
`convert()` ever stopped invoking the validator, AS-116 would go silently
uncovered.

**M-5 (AS-118 / AS-119 / AS-101) — the assertions' subject does not exist yet.**
`app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` is a 39-line static
placeholder; `components/webflow-tool/` does not exist; nothing outside
`lib/webflow-converter/` imports `convert` or `validatePayload`. "The user
sees an error instead" (AS-118) and "no escape hatch to copy anyway"
(AS-119) are satisfied only at the library contract level (`convert.ts:82-90`
returns `payload: null` when invalid — mutating that kills 8 tests). Both
will re-open the moment the UI lands. Likewise AS-101's "combined HTML +
JS-tab input" clause: `convert(html, css)` takes no JS parameter, so the
concatenation the assertion describes is unimplemented.

---

## Minors

- `emit.ts:86` `active: "pressed"` is **dead code** — `css.ts:14`
  `STATE_ALIASES` already normalises `active`→`pressed` before emit sees it.
  Deleting the line survives every test. Misleading.
- `js-extract.ts:39` — `<script src>` or `<script src="  ">` fails the
  `src.trim() !== ""` guard, falls into the inline branch, has no text
  content, and is discarded with **no script entry and no warning**. Same for
  whitespace-only inline scripts (`:50`).
- `js-extract.ts:45-48` — inline script text is read from `TEXT_NODE` children
  only; any CDATA/comment child is dropped silently. Untested.
- `css.ts:188-191` catches *all* errors from `expandDeclaration` and downgrades
  them to warnings; a genuine bug inside `longhand.ts` is indistinguishable
  from bad user CSS and never fails a conversion.
- `convert.test.ts:78` asserts the *shape* of the implementation's object
  literal (`customCode.styles` is `undefined`) rather than behaviour — it
  would pass even if styles were routed to custom code under another key.
- `convert.test.ts:202-215` is named "de-duplicates warnings" but its own
  comment concedes the two warnings are distinct strings; the `Set` at
  `convert.ts:43` makes it tautological. It cannot fail for the reason its
  name claims.
- `js-extract.ts:65` — `extractStyles` returns a `warnings` array that is
  never populated; `convert.ts:43` spreads it. Dead channel, harmless.
- `emit.test.ts:250`, `:258`, `:267`, `:275` assert `toBeTruthy()` on
  `styleLess` rather than an exact value, so a mutant emitting the *wrong*
  declarations into the right slot survives. The `hover`/`focus-visible`
  tests do use exact strings — make these consistent.
- `makeId()` (`emit.ts:98-104`) has an untested non-`crypto` fallback.

---

## Recommended follow-up features

**F-A — Fix composite breakpoint+state key construction for prefixed states.**
Separate the Webflow *state* token from the *breakpoint* prefix in
`PSEUDO_STATE_TO_WEBFLOW`. Today the map conflates them: `visited` maps to
`"main_visited"`, which is the fully-qualified main-breakpoint key rather
than the state token `"visited"`. Restructure so the map yields a bare state
token (`visited`, `placeholder`, `hover`, `focused-visible`, …) and a single
key-composition helper prefixes it with the breakpoint (`main` for the base
breakpoint, `medium`/`small`/`tiny`/`large`/`xl`/`xxl` otherwise), producing
`main_visited` and `medium_visited` from the same code path. Add a table-driven
test that walks the full cross-product of all six breakpoints against all
eight AS-041 pseudo-states and asserts the exact emitted variant key for each
of the 48 combinations, so no future state can be prefixed twice or dropped.
Verify the emitted key set contains no `main_` substring outside the base
breakpoint.

**F-B — Assert verbatim carry-through of external script tags (AS-103).**
Add fixtures to `js-extract.test.ts` using external scripts that carry
attributes beyond `src` — at minimum `defer`, `async`, `type="module"`,
`integrity="sha384-..."`, `crossorigin="anonymous"`, a `data-*` attribute,
single-quoted values, and a non-alphabetical attribute order. Assert the
collected custom-code entry is **string-equal to the exact source substring**,
not merely that it contains the `src`. The acceptance criterion is a mutation
gate: replacing `scripts.push(el.outerHTML)` with any re-serialization built
from parsed attributes must fail at least one test. Also add a case proving
there is no allowlist — a script from an arbitrary third-party origin is
carried through unchanged.

**F-C — Enforce and test the no-shorthand guarantee at the payload layer
(AS-069).** Move the shorthand check out of the inline array inside the AS-141
integration test and into a shared, exported helper (e.g. a
`findShorthandProperties(payload)` used by both `validator.ts` and the tests),
so that a payload containing any shorthand in `styleLess` *or in any
breakpoint or state variant* is a validation error rather than merely an
untested expectation. Add emit-level tests that place shorthands
(`padding`, `margin`, `border`, `border-radius`, `font`, `flex`, `transition`,
`list-style`) inside `:hover`, `::placeholder`, and composite
breakpoint+state rules, and assert no shorthand key survives in any variant.
Acceptance gate: a mutant that skips `expandDeclaration` for state variants
only must fail the suite.

**F-D — Make the AS-011 Supabase scan non-vacuous.** Replace the basename
filter in `convert.test.ts` with a full-path match (`fullPath` containing the
converter route segment or `components/webflow-tool/`), and change the
predicate from a raw `"supabase"` substring to import/call detection
(`@/lib/supabase`, `createClient`, `.from(`), since the page legitimately
mentions Supabase in prose. The test must first be shown to match a non-zero
file count — add an explicit `expect(webflowFiles.length).toBeGreaterThan(0)`
guard so the scan can never silently degrade to zero files again as the UI
grows.

**F-E — Direct uniqueness and hygiene assertions in `emit.test.ts` (AS-116,
minors).** Add an emit-level assertion that `new Set(styles.map(s => s._id)).size
=== styles.length` so uniqueness does not depend on `convert()` continuing to
call the validator. Alongside it: delete the dead `active: "pressed"` entry at
`emit.ts:86` (or add a test that pins it as a defensive alias), emit a warning
instead of silently discarding `<script src="">` and whitespace-only inline
scripts in `js-extract.ts:39/50`, tighten the `toBeTruthy()` assertions at
`emit.test.ts:250/258/267/275` to exact `styleLess` strings, and either fix or
delete the tautological "de-duplicates warnings" test at
`convert.test.ts:202-215`.

**F-F — Defer AS-101 / AS-118 / AS-119 re-validation to the converter UI
milestone.** These three assertions describe the JS-tab input and the copy
action, neither of which exists in M3. When the converter UI feature lands,
re-run scrutiny against them specifically: the copy control's disabled state
must derive from `ValidationResult.valid`, there must be no force/override/
ignore-warnings path, errors must be surfaced to the user, and `convert` must
accept the JS-tab text and concatenate it into the single ordered custom-code
output ahead of or behind the HTML-derived scripts per AS-110's ordering rule.

---

## Command output

```
$ npx vitest run lib/webflow-converter/

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  376 passed (376)
   Start at  23:30:27
   Duration  483ms (transform 256ms, setup 410ms, import 321ms, tests 93ms)

[exited with code 0]
```

```
$ npx tsc --noEmit
(no output)
[exited with code 0]
```

```
$ npm run lint

> pm-app@0.1.0 lint
> eslint

[exited with code 0]
```

### Independent probe — AS-041 composite keys (lead validator)

```
$ npx tsx /tmp/probe.mts
CSS VARIANT KEYS:     ["medium_visited","medium_placeholder","medium_focus-visible","medium_hover"]
EMITTED VARIANT KEYS: ["medium_main_visited","medium_main_placeholder","medium_focused-visible","medium_hover"]
WARNINGS: []
```

### Independent probe — shorthand expansion reaches variants (AS-069 behaviour is correct today)

```
$ npx tsx /tmp/probe2.mts
"styleLess": "margin-bottom: 1px; margin-left: 2px; margin-right: 2px; margin-top: 1px;",
"variants": {
 "hover":  { "styleLess": "padding-bottom: 3px; padding-left: 4px; padding-right: 4px; padding-top: 3px;" },
 "medium": { "styleLess": "border-bottom-color: red; border-bottom-style: solid; ... border-top-width: 1px;" }
}
```

### Independent probe — unsupported shorthands warn rather than silently drop

```
$ npx tsx /tmp/probe3.mts
"background: red"       -> ""  warn: [".a: shorthand 'background' is not supported — write longhands instead"]
"font: 12px/1.5 Arial"  -> "font-family: Arial; font-size: 12px; line-height: 1.5;"           warn: []
"flex: 1 1 auto"        -> "flex-basis: auto; flex-grow: 1; flex-shrink: 1;"                  warn: []
"grid-area: a"          -> ""  warn: [".a: shorthand 'grid-area' is not supported — write longhands instead"]
"transition: all .2s"   -> "transition-delay: 0s; transition-duration: .2s; ..."              warn: []
"border-radius: 4px"    -> "border-bottom-left-radius: 4px; ... border-top-right-radius: 4px;" warn: []
"background-color: red" -> "background-color: red;"                                           warn: []
```

### Independent probe — payload envelope (AS-111)

```
$ npx tsx /tmp/probe4.mts
top keys: [ 'payload', 'warnings' ]
payload:  {"type":"@webflow/XscpData","payload":{"nodes":[...],"styles":[...]}}
```

### Mutation harness baselines

Both reviewers copied the module to `/tmp` with a standalone vitest config.
Baseline in the copied location is 375 pass / 1 fail — the single failure is
`convert.test.ts:328` ("AS-011"), which resolves `process.cwd()` and therefore
fails anywhere outside the repo root. Not a real signal; noted because it is
itself evidence that the AS-011 test is environment-coupled.

Surviving mutants (the ones that matter):

```
M19  css.ts:182        skip expandDeclaration when variantKey.includes("_")   SURVIVED  -> AS-069
M-JS js-extract.ts:41  outerHTML -> `<script src="${src}"></script>`           SURVIVED  -> AS-103
M-DC emit.ts:86        delete `active: "pressed"`                              SURVIVED  -> dead code
```

Killed mutants are tabulated in the "What was fixed" and "Assertion table"
sections above.

### Verification of AS-011 filter emptiness

```
$ find app components -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts*' | awk -F/ 'tolower($NF) ~ /webflow/' | wc -l
0

$ find app components -ipath "*webflow*"
app/(workspace)/w/[workspaceSlug]/tools/webflow
app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx
```
