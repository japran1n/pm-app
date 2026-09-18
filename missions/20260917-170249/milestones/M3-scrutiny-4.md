# M3 scrutiny — round 4 — HTML / emit / validate engine (F015–F021, F075–F087)

**Result: FAIL** — 1 blocker (down from 3), 3 majors.

Read-only review. `git status` clean for `lib/`. Findings come from reading the
code, two independent parallel reviewers given only assertion text + file lists
(no handoff, no worker reasoning), live `convert()` probes, mutation testing,
and a web search of Webflow's real pseudo-state vocabulary.

Suite, lint, typecheck green: **374/374**, `tsc` exit 0, `eslint` exit 0.

## What round 4 genuinely fixed

- **AS-091 (round-3 B-3) — fixed, and well tested.** `emit.ts:227-231` builds a
  lowercased attribute map once per element and every lookup (`type`, `style`,
  `class`, `id`, `data-`) drives off it. Probe:
  `<div ID="Hero" CLASS="a" DATA-FOO="1">` → `classes:["a"]`,
  `xattr:[{id:Hero},{data-foo:1}]`. Five dedicated uppercase tests
  (`emit.test.ts:96,102,108,113,119`); mutating `k.toLowerCase()` back to `k`
  turns exactly those five red. Real guards.
- **AS-041 breakpoint fold (round-3 B-2) — the clobber and the false warning are
  gone.** `emit.ts:125-161` accumulates declaration *objects* per slot and
  stringifies once. Both `@media` orderings now behave identically; no duplicate
  property appears in a `styleLess`; the hover-only declarations no longer land
  in the unconditional breakpoint slot. Two tests
  (`emit.test.ts:298`, `:311`) pin both orderings. (But see B-1 (c) — the chosen
  remedy is "drop with a warning", and the warning's premise is false.)
- **AS-119 tautology (round-3 R-6) — gone.** `convert.test.ts:167,177,185` now
  feed genuinely invalid input (unresolved class, empty document, comment-only
  document) and assert `payload === null` + a specific error unconditionally.
  Mutating `convert.ts:85` to return the payload anyway turns 8 tests red.
- **AS-051 combo-chain branch (round-3 R-1) — now guarded.**
  `convert.test.ts:114` and `:125`. Replacing the per-node chain match with the
  flat `usedClasses` set goes red.
- **AS-114 depth-3 (round-3 R-7) — added.** `convert.test.ts:133`.

Escape-hatch grep (`anyway|force|override|skipValidation|allowInvalid|bypass`)
across `lib/webflow-converter`, `app`, `components`: comments only.

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | **FAIL (major M-3)** | Lib half is a real guard (`convert.test.ts:328`); the newly added page/component scan at `:340-372` filters by *filename* containing "webflow", and no such file exists — the converter route is `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx`, matched by directory. `webflowFiles` is empty; the loop asserts nothing. |
| AS-041 | **FAIL (blocker B-1)** | `:visited` and `::placeholder` are still discarded, and `emit.test.ts:262,270` assert the discard as correct. `:focus-visible` is aliased onto the same slot as `:focus`, silently overwriting it. Per-breakpoint states dropped on a false premise. |
| AS-051 | PASS | `convert.test.ts:107,114,125`. Both the recursion and the combo-chain branch are mutation-killed. |
| AS-069 | **FAIL (major M-2)** | Surviving mutant: make only pseudo-state variants bypass `expandDeclaration` at `css.ts:187` → **374/374 green** while shorthand leaks verbatim into `variants.hover/focused/pressed/before/after`. The only variant-level shorthand sweep is incidental (`convert.test.ts:290`, inside the AS-141 test) and its hover rule uses longhand. `validator.ts` never inspects `styleLess` content. |
| AS-089 | PASS (minor) | `emit.ts:71` `SKIPPED_TAGS`; mutation-killed by `emit.test.ts:46`. The two convert-level tests labelled AS-089 (`convert.test.ts:66,84`) assert only that content is extracted, never that no node remains — removing `script`/`style` from `SKIPPED_TAGS` leaves them green. |
| AS-091 | PASS | Fixed. See above. |
| AS-101 | PASS (engine scope) | `js-extract.ts:35-53`; mutation-killed by 3 tests. The "JS-tab input" half has no plumbing (`convert()` takes no `js` argument) — M4+. `<script>` inside `<noscript>`/`<template>` still vanishes silently (round-3 R-3, unaddressed). |
| AS-103 | **FAIL (major M-1, carried from round 3 R-4)** | Behaviour verified correct (`el.outerHTML`, `js-extract.ts:41`; `async/defer/type=module/integrity/crossorigin` round-trip verbatim). But the re-serializing mutant `scripts.push(\`<script src="${src}"></script>\`)` still passes **374/374**. All three fixtures use the one bare shape where the two coincide. Test mirrors implementation. |
| AS-110 | PASS | `js-extract.test.ts:33`; `.reverse()` mutant → 3 red. |
| AS-111 | PASS | `emit.ts:304` literal; `convert.ts:77-80` threads it; `validator.ts:175` enforces; mutation-killed by `validator.test.ts:182,191`. |
| AS-112 | PASS | `validator.ts:187`; mutation-killed by 4 tests. `convert("","")` → `payload: null`. |
| AS-114 | PASS | `validator.ts:85`, unconditional recursion; mutation-killed at depth 1 and depth 3. Residual: `validator.ts:83` skips all class checks when `styles` is not an array (round-3 R-11). |
| AS-116 | PASS (minor) | `validator.ts:115`; mutation-killed by `validator.test.ts:246`. Tested only against hand-built payloads — nothing asserts `emit`'s id generator can't collide. Duplicate style *names* (round-3 R-5) remain out of the assertion's wording. |
| AS-117 | PASS | Composite-key base lookup (`emit.ts:171`) + children second pass (`:201`); both sides mutation-killed (`validator.test.ts:262,278`; `emit.test.ts` AS-117 trio). |
| AS-118 | PASS (engine scope, per scoring note) | `convert.ts:82-90` returns `payload: null` on any `!validation.valid`, no override argument. Mutating it to return the payload anyway → 8 red. No caller of `convert()` exists yet; UI copy surface is M4–M6. |
| AS-119 | PASS (engine scope) | Tautology replaced; see above. The "no copy-anyway affordance" half cannot be tested until a copy UI exists. |
| AS-141 | PASS | `convert.test.ts:217-305`; mutation-killed by the emit combo-children mutant. Pins node count, envelope, combo parentage both directions, hover, `medium` + `tiny`, zero errors, warnings. |

---

## Blocker

### B-1 — AS-041 still loses two of its eight named states, aliases a third, and drops per-breakpoint states on a premise the evidence contradicts. [AS-041]
`lib/webflow-converter/emit.ts:78-86`, `:142-150`; `lib/webflow-converter/emit.test.ts:262-277`

Probe, one selector per run on `.btn`:

```
:hover          -> {"hover":...}     ok
:active         -> {"pressed":...}   ok
:focus          -> {"focused":...}   ok
::before        -> {"before":...}    ok   (new)
::after         -> {"after":...}     ok   (new)
:focus-visible  -> {"focused":...}   ALIASED onto :focus
:visited        -> {}  warn+dropped
::placeholder   -> {}  warn+dropped
```

Three distinct defects:

**(a) `:visited` and `::placeholder` are still discarded, and the suite still
asserts the inverse of the contract.** `emit.test.ts:262`
(`..._visited_pseudo_state_has_no_webflow_slot_and_warns`) and `:270`
(`..._placeholder_pseudo_state_has_no_webflow_slot_and_warns_not_nthChild`)
both assert `expect(Object.keys(style.variants)).toHaveLength(0)`. A correct
implementation would turn these red. This is the same test-integrity regression
flagged in round 3, merely reduced from five states to two.

The "no Webflow slot exists" premise is **false**, and this was checkable.
Webflow's own Designer Extension API documents `PseudoStateKey` as including
`visited` and `placeholder`
(https://developers.webflow.com/designer/reference/styles-overview), the
Designer's States dropdown lists Visited and Placeholder
(https://help.webflow.com/hc/en-us/articles/33961301727251-States), and real
`@webflow/XscpData` clipboard payloads in the wild contain `main_placeholder`
and `main_visited` variant keys. The code asserted a limitation without
evidence — exactly the failure mode that produced `placeholder: "nthChild"` in
round 2.

**(b) `:focus-visible` is aliased onto `focused`, silently destroying `:focus`.**
`emit.ts:81` maps `"focus-visible" -> "focused"`. Probe:

```
.btn:focus{color:red}  .btn:focus-visible{color:blue}
-> variants: {"focused":{"styleLess":"color: blue;"}}    warnings: []
```

The `:focus` declaration is gone with no warning. Webflow treats Focused and
Focused (keyboard) as *separate* states ("Focused (keyboard) styles will
override the Focused styles"), so they are not interchangeable. The passing test
at `emit.test.ts:238` cannot detect this — it supplies `:focus-visible` alone.

**(c) Per-breakpoint pseudo-states are dropped on a false premise.**
`emit.ts:143-150` warns *"per-breakpoint pseudo-state is not representable in
Webflow's class editor"* and discards the declarations. Round 3's FU-B did
sanction "drop with an honest warning" as an acceptable remedy — but the warning
is not honest: `medium_hover` and `xxl_hover` are the actual variant key shape
used in real Webflow clipboard payloads, which is also exactly the key
`css.ts` already produces. The data is representable; it is being thrown away.
Severity: this rides on the same blocker because both defects are one fix.

---

## Majors

### M-1 — AS-103's verbatim guarantee still has zero effective coverage. [AS-103]
`lib/webflow-converter/js-extract.ts:41`, `js-extract.test.ts:12,21,33`

Carried verbatim from round 3 R-4; not addressed. Behaviour is correct, but
replacing `el.outerHTML` with a re-serialized `<script src="...">` — dropping
`async`, `defer`, `type="module"`, `integrity`, `crossorigin` — passes the
entire 374-test suite. Every fixture uses the one bare shape where verbatim
carry and naive re-serialization produce identical strings. Per the scrutiny
standard, a test that cannot distinguish the assertion's intent from its
negation is FAILED.

### M-2 — AS-069 has no test that would catch shorthand leaking into a pseudo-state variant. [AS-069]
`lib/webflow-converter/css.ts:187`, `lib/webflow-converter/validator.ts:140`

Surviving mutant, confirmed green at 374/374:

```ts
// css.ts:187
if (variantKey && variantKey.includes("_")) { bucket[child.prop] = child.value; }
else { Object.assign(bucket, decls); }
```

`background: red url(x)` inside `.btn:hover` then reaches
`variants.hover.styleLess` unexpanded. Nothing catches it: `emit.test.ts`
contains zero shorthand assertions, and the one variant-level sweep
(`convert.test.ts:290`) sits inside the AS-141 integration test whose only hover
rule already uses the longhand `background-color`. `validator.ts` never inspects
`styleLess` *content* — only that it is a string — so there is no second line of
defence for an assertion phrased as an absolute negative over the whole payload.

Also still open from round 2: `longhand.ts:370-377` `PASS_THROUGH` emits
`background-position` and `background-size` verbatim; both have longhands.

### M-3 — AS-011's page-level scan is inert. [AS-011]
`lib/webflow-converter/convert.test.ts:340-372`

The round-4 extension walks `app/` and `components/` but selects files with
`entry.name.toLowerCase().includes("webflow")` — a *filename* test.
`find app components -iname "*webflow*" -name "*.ts*"` returns zero results;
the converter lives at
`app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx`, where "webflow" is a
directory segment. `webflowFiles` is `[]` and the loop body never executes.

Worse, the fix is not a one-liner: switching the filter to match the full path
turns the test red immediately, because that `page.tsx:24` contains the string
"Supabase" in a comment (`// AS-009/AS-010: this page makes no Supabase query
of its own ...`). The behaviour AS-011 asserts does hold — the page is a static
server component with no Supabase import — but the check needs to be an
import/call-site check, not a substring grep, before it can be pointed at the
page at all.

---

## Non-blocking recommendations

- **R-1 — AS-089 has no convert-level node-absence assertion.** `convert.test.ts:66,84`
  survive removal of `script`/`style` from `SKIPPED_TAGS`. Add a node-tag sweep.
- **R-2 — `<script>` inside `<noscript>` or `<template>` still vanishes with no
  warning** (round-3 R-3). Both are in `SKIPPED_TAGS` (`emit.ts:71`) and
  `noscript` is raw text to the parser, so the script reaches neither output.
- **R-3 — `validator.ts:83`:** non-array `styles` silently skips every AS-114
  class check. `valid` is still false, so AS-118 holds, but the error list is
  misleadingly short.
- **R-4 — AS-116 is validator-side only.** Nothing asserts `emit`'s id generator
  cannot collide, and duplicate style *names* (standalone `b` + combo `b`, plus
  phantom empty standalones for `.c.d`) persist. Webflow resolves by name on
  paste. Needs a decision and probably a new assertion ID.
- **R-5 — `convert.test.ts:202` ("de-duplicates warnings") is self-defeating** —
  its own comment concedes the two warnings are distinct strings, so the
  `Set.size === length` assertion holds for any input. The actual de-dup at
  `convert.ts:43` is untested.
- **R-6 — `scripts[]` still mixes two representations** (bare JS bodies vs. full
  tag markup) and is never joined into the "single custom-code output" AS-101
  words. Settle before M4 writes a consumer.
- **R-7 — `convert.ts:77-80`** validates a synthesized `{...payload.payload, type}`
  object while returning `emitResult.payload`. Equivalent today; can drift.
- **R-8 — One unreproducible red baseline observed.** A single
  `npx vitest run lib/webflow-converter/` returned `2 failed | 372 passed`
  (`validator.test.ts:187`, `:199`), green on four subsequent runs and green
  when the file runs alone. Probably a stale transform cache, but it is a real
  red baseline that was observed once and should be watched.

---

## Recommended follow-up features

**FU-A — Implement `:visited` and `::placeholder`, split `:focus-visible` from
`:focus`, and keep per-breakpoint states.** In `lib/webflow-converter/emit.ts`,
extend `WebflowStyleVariants` and `PSEUDO_STATE_TO_WEBFLOW` so all eight states
AS-041 names reach a distinct slot. The slot vocabulary must come from Webflow's
documented `PseudoStateKey` set and from a real clipboard payload copied out of
the Designer, not from inference — that is how `placeholder: "nthChild"` got in
and how the current "no slot exists" comment got in. Delete
`emit.test.ts:262-277`, the two tests that assert `:visited` and `::placeholder`
produce *no* variant; they assert the inverse of an immutable contract assertion
and will block any correct implementation. Replace each with a slot + `styleLess`
assertion. `:focus-visible` must get its own slot, and a test must supply
`:focus` and `:focus-visible` together and assert both survive — today the
second silently overwrites the first. Finally, since `medium_hover`-shaped keys
are the real clipboard representation, replace the "not representable" drop at
`emit.ts:142-150` with emission into the composite breakpoint-state slot, and
pin it with a test; if some specific breakpoint-state combination genuinely has
no representation, that limitation is recorded as a **new** assertion ID with an
accurate user-facing warning — AS-041 is never narrowed. Covers AS-041.

**FU-B — Make the AS-103 and AS-069 tests able to fail.** Add a `js-extract`
fixture asserting byte-identical carry-through of
`<script async defer type="module" integrity="sha384-abc" crossorigin="anonymous" src="/a.js"></script>`,
plus single-quoted, unquoted and uppercase-tag variants, so a re-serializing
regression cannot pass green — it currently does, 374/374, silently dropping
every one of those attributes. Separately, add an emit-layer AS-069 test that
feeds shorthand declarations (`font`, `background`, `border`, `margin`,
`padding`, `flex`, `transition`) inside `:hover`, `:focus`, `::before` and
inside an `@media` block, and asserts no shorthand property name appears in any
`styleLess` anywhere in the payload — base or variant. Today a mutant that
expands only base and breakpoint declarations, leaving pseudo-state variants
unexpanded, passes the whole suite. Consider also adding a shorthand scan to
`validator.ts` so the assertion has a second line of defence, since AS-069 is
phrased as an absolute negative over the entire payload. Covers AS-069, AS-103.

**FU-C — Make the AS-011 check real and behavioural.** The current page scan
matches files whose *filename* contains "webflow" and therefore matches nothing;
the converter page is identified by its directory. Point the check at the actual
route (`app/(workspace)/w/[workspaceSlug]/tools/webflow/**`) and at any
`components/**` file it imports, and change it from a substring grep to an
import/call-site check — parse the module graph reachable from the page and
assert no `@supabase/*` import, no `createClient`, and no server action that
queries a table. A substring grep cannot be pointed at that page today without
going red on an explanatory comment, and would in any case miss a Supabase call
reached through an indirectly-named helper. Also add a convert-level AS-089
assertion that no node in the payload has tag `script` or `style` — the two
existing convert-level AS-089 tests survive removal of those tags from
`SKIPPED_TAGS`. Covers AS-011, AS-089.

**FU-D — Close the silent-loss paths in custom-code extraction.** Warn when a
`<script>` inside `<noscript>` or `<template>` is encountered and decide whether
to hoist it — today it appears in neither the node tree nor `customCode.scripts`
and nothing warns. Warn when a script's raw text terminates mid-token because
`</script>` appeared inside a string literal, and on self-closing
`<script src="..."/>`, which reparents every following sibling. Settle
`scripts[]` on a single representation — raw bodies or tag markup, not both —
and decide whether AS-101's "single custom-code output" means a joined blob,
before M4 writes a consumer. Covers AS-101, AS-103, AS-110.

---

## Command output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  374 passed (374)
   Start at  23:13:58
   Duration  488ms (transform 259ms, setup 416ms, import 332ms, tests 89ms, environment 0ms)
```

(One earlier run in this session reported `2 failed | 372 passed` at
`validator.test.ts:187,:199`; not reproducible across five subsequent runs. See R-8.)

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
-- AS-041 pseudo-states (one selector per run, .btn{color:#000} + .btn<state>{color:red}) --
:hover          [{"hover":{"styleLess":"color: red;"}}]        warnings []
:active         [{"pressed":{"styleLess":"color: red;"}}]      warnings []
:focus          [{"focused":{"styleLess":"color: red;"}}]      warnings []
:focus-visible  [{"focused":{"styleLess":"color: red;"}}]      warnings []
:visited        [{}]  warn 'variant "main_visited" on .btn does not map to a Webflow state — skipped'
::placeholder   [{}]  warn 'variant "main_placeholder" on .btn does not map to a Webflow state — skipped'
::before        [{"before":{"styleLess":"color: red;"}}]       warnings []
::after         [{"after":{"styleLess":"color: red;"}}]        warnings []

-- AS-041 focus / focus-visible collision (B-1 b) --
.btn:focus{color:red}.btn:focus-visible{color:blue}
-> variants {"focused":{"styleLess":"color: blue;"}}   warnings []     <-- :focus lost, silently

-- AS-041 fold, formerly-unlucky order (round-3 B-2, now fixed) --
.btn{color:red}@media(max-width:991px){.btn:hover{color:green}}@media(max-width:991px){.btn{background-color:pink}}
-> styleLess "color: red;"  variants {"medium":{"styleLess":"background-color: pink;"}}
   warn '"medium_hover" on .btn: per-breakpoint pseudo-state is not representable ... skipped'
   (no clobber, no false claim of preservation; but see B-1 c — the premise is false)

-- AS-041 fold, formerly-lucky order --
.btn{color:#000}.btn:hover{color:red}@media(max-width:991px){.btn{color:green}.btn:hover{color:blue}}
-> variants {"hover":{"styleLess":"color: red;"},"medium":{"styleLess":"color: green;"}}
   (no duplicate `color`; hover no longer leaks into the unconditional medium slot)

-- AS-091 uppercase attributes (round-3 B-3, now fixed) --
convert('<div ID="Hero" CLASS="a" DATA-FOO="1" STYLE="color:red">x</div>','.a{color:red}')
-> node {"tag":"div","classes":["a"],"data":{"xattr":[{"name":"id","value":"Hero"},{"name":"data-foo","value":"1"}]}}
   errors []   warnings ['<div> has an inline style="" attribute — use a class instead']
```

### Surviving mutants (mutation testing, all reverted; `git status` clean for `lib/`)

```
AS-103  js-extract.ts:41  scripts.push(el.outerHTML)
        -> scripts.push(`<script src="${src}"></script>`)
        SUITE: 374/374 PASS. async/defer/type=module/integrity/crossorigin dropped undetected.

AS-069  css.ts:187  Object.assign(bucket, expandDeclaration(...))
        -> if (variantKey?.includes("_")) bucket[child.prop] = child.value; else Object.assign(...)
        SUITE: 374/374 PASS. Shorthand leaks verbatim into hover/focused/pressed/before/after.

AS-011  convert.test.ts:340-372 page scan
        No mutant needed: webflowFiles === [] on this repo; the loop body never runs.
```

### Mutants that were correctly killed

```
AS-051  convert.ts if(!isUsed) -> if(false)                     -> red
AS-051  combo-chain branch -> flat usedClasses.has              -> red (convert.test.ts:114,125)
AS-089  remove script/style from SKIPPED_TAGS                   -> red (emit.test.ts:46 only)
AS-091  attrs[k.toLowerCase()] -> attrs[k]                      -> red (5 uppercase tests)
AS-091  remove attrs.id -> xattr.unshift block                  -> red (3 tests)
AS-110  scripts.slice().reverse()                               -> red (3 tests)
AS-111  drop EXPECTED_TYPE check (validator.ts:175)             -> red
AS-112  drop nodes.length===0 error (validator.ts:187)          -> red
AS-114  drop !styleNames.has(cls) error (validator.ts:85)       -> red (depth 1 and depth 3)
AS-116  drop Duplicate style _id push (validator.ts:115)        -> red
AS-117  drop base.children check (validator.ts:148)             -> red
AS-117  drop base.children.push second pass (emit.ts:201)       -> red
AS-118  convert.ts:85 return emitResult.payload instead of null -> 8 red
```

### AS-118 consumer scan

```
$ grep -rn "webflow-converter" --include='*.ts' --include='*.tsx' app components lib hooks tests | grep -v '^lib/webflow-converter/'
tests/unit/f004-webflow-tool-portal-isolation.test.ts:117
tests/unit/f004-webflow-tool-portal-isolation.test.ts:118
```

Still no caller of `convert()`. Per the M3 scoring note, AS-118 and AS-119 are
scored on the engine-level guarantee only; the copy surface lands in M4–M6.
