# M3 scrutiny — round 2 — HTML / emit / validate engine (F015–F021 + F075–F081)

**Result: FAIL**

Reviewed read-only. Nothing in the repo was modified (`git status` clean for
`lib/`). Findings come from reading the code, from three independent parallel
reviewers given only the assertion text and the file list, and from live probes
of `convert()` run from a scratch directory outside the project.

Lint, typecheck and the full converter suite are **green (347/347)**. Round 1's
eight blockers have been *partially* addressed: four are genuinely fixed
(AS-111 envelope, AS-091 `id`, AS-101/103/110 external scripts, AS-089 inline
`<style>` merge, AS-141 integration test). The remaining four were "fixed" by
adding code that the production entry point then neutralises, or by mapping
only the easy subset of a set-valued assertion. Two *new* escape hatches were
introduced in `convert.ts` that did not exist in round 1.

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | PASS | `convert.test.ts:263` scans every non-test source file in the module for "supabase". Genuine guard. |
| AS-041 | **FAIL (blocker, B-1)** | Only 4 of the contract's 8 pseudo-states reach a variant slot. `::placeholder` is written to Webflow's `nthChild` slot. Breakpoint+state variants collapse into one flat slot, silently destroying the desktop state. |
| AS-051 | **FAIL (blocker, B-2)** | `usedClasses` does not recurse into child nodes. Every class used only on a nested element is falsely reported unused. |
| AS-069 | PASS (major, R-1) | Holds empirically via `longhand.ts`. Still no assertion at the emit/payload layer other than inside the AS-141 test; `background-position` / `background-size` pass through verbatim via `longhand.ts:370-377`. |
| AS-089 | PASS | `convert.ts:37-40` merges `<style>` text into `parseCss`; `emit.ts:69,186` keeps `script`/`style` out of `nodes`. Probe: `<style>.only{color:red}</style>` now produces a real `only` style and 1 node. Asserted at `convert.test.ts:40-56`. Round-1 B-3 fixed. |
| AS-091 | PASS | `emit.ts:211-213` unshifts `{name:"id"}` into `data.xattr`. Probe confirms round-trip. `emit.test.ts:72-76` would fail if removed. Round-1 B-4 fixed. |
| AS-101 | PASS (major, R-2) | `js-extract.ts:35-53` collects inline bodies and external tags into one array. Caveat: the "JS-tab input" half of the assertion has no implementation and no consumer yet. |
| AS-103 | PASS (major, R-3) | `js-extract.ts:41` pushes `el.outerHTML` — genuinely verbatim (probe confirms `async`/`defer`/`integrity`/`crossorigin`/quoting/case all survive). But **no test would fail** if this were replaced by a re-serializer; all three tests use the canonical `<script src="X"></script>` form. Round-1 B-1 fixed in code, not in test. |
| AS-110 | PASS | `js-extract.test.ts:33-39` uses a 3-element interleaved inline/external/inline case asserting exact array equality. Real guard. |
| AS-111 | PASS | `emit.ts:261` hard-codes the literal; `convert.ts:90` threads it into `validatePayload`; probe shows `Object.keys(payload) === ["type","payload"]`. Round-1 B-2 partially fixed. |
| AS-112 | **FAIL (blocker, B-3)** | `convert.ts:85` sets `allowEmptyNodes` for blank HTML and `validator.ts:190` then skips the check. Probe: `convert("","")` returns `errors: []`, a non-null payload, and `nodes: []`. `convert.test.ts:30-38` pins this wrong behaviour as correct. |
| AS-113 | PASS (vacuous, minor) | Children are inlined objects, not id refs; resolution cannot fail by construction. Unchanged from round 1. |
| AS-114 | **FAIL (blocker, B-4)** | `convert.ts:69-89` synthesises `fake: true` placeholder styles, validates against the augmented copy, then returns the **unaugmented** payload. Probe: `convert('<div class="ghost"></div>', '')` returns a payload whose node references class `ghost` with `styles: []`. |
| AS-115 | PASS (major) | `validator.ts:71-72`; now covered at `validator.test.ts`. |
| AS-116 | PASS | `validator.ts:114-118`, tested `validator.test.ts:245-259` with a hand-built duplicate. Would fail if the branch were removed. Round-1 gap closed. |
| AS-117 | **FAIL (blocker, B-5)** | 2-level combos work. 3-level chains attach the combo to the **wrong base**: `emit.ts:143-149` resolves `comboOf[last]` (the bare name `"b"`) through `idByKey`, which returns the *standalone* `.b` style rather than the `.a.b` combo. No warning. |
| AS-118 | **FAIL (blocker, B-6)** | Composite: AS-041/051/112/114/117 still violate, so violating payloads are still returned as successes. Separately, there is **no consumer of `convert()` anywhere in the repo** — no copy action, no error surface — so the "never offered for copy" half is unrealised and untestable at this milestone. |
| AS-119 | PASS (major, R-4) | No `force`/`anyway` flag. But `allowEmptyNodes` is an escape hatch in exactly that shape, `fakeStyles` is a silent one, and the covering test `convert.test.ts:115-132` is still the round-1 tautology (`if errors>0 expect null else expect not-null` on known-good input). |
| AS-120 | PASS | `convert.ts:105-111`. |
| AS-129 | PASS | Pure function, no I/O. |
| AS-141 | PASS | `convert.test.ts:159-262` is genuinely strong: zero errors, type envelope, recursive flatten to exactly 6 nodes, combo linkage in both directions, hover variant content, both breakpoints, and a shorthand sweep over base *and* variant `styleLess`. Each would fail on regression. Round-1 B-6 fixed. Its one gap: it never asserts `warnings`, which is how B-2's false positives on its own nested markup stay hidden. |

---

## Blockers

### B-1 — Half the supported pseudo-states are dropped, and `::placeholder` is written to the wrong Webflow slot. [AS-041]
`lib/webflow-converter/emit.ts:75-82`

```ts
const PSEUDO_STATE_TO_WEBFLOW: Record<string, string> = {
  hover: "hover", focus: "focused", pressed: "pressed",
  active: "pressed", placeholder: "nthChild",
};
```

AS-041 names eight states. `css.ts:12-21` parses all eight correctly. Probe
results, one selector per run on `.btn`:

```
:hover           -> {"hover":...}        ok
:active          -> {"pressed":...}      ok
:focus           -> {"focused":...}      ok
:focus-visible   -> {}   warning, dropped
:visited         -> {}   warning, dropped
::before         -> {}   warning, dropped
::after          -> {}   warning, dropped
::placeholder    -> {"nthChild":...}     WRONG SLOT, no warning
```

`nthChild` is Webflow's nth-child structural variant, not a placeholder slot.
A `::placeholder` rule is therefore applied to the wrong elements on paste with
no signal to the user. `WebflowStyleVariants` (`emit.ts:25-36`) has no slots for
visited / focus-visible / before / after at all, so this is structural.

**Second, worse defect in the same block.** `emit.ts:129-135` splits the
variant key `"<breakpoint>_<state>"` and keeps only the state half, writing every
breakpoint's version of a state into one flat slot. Probe:

```
input : .btn:hover{color:red} @media (max-width:991px){.btn:hover{color:blue}}
output: {"hover":{"styleLess":"color: blue;"}}   warnings: []
```

The desktop hover style is silently overwritten by the tablet one. Last-write-
wins data loss with zero warnings. `emit.test.ts:142` covers `:hover` at the
default breakpoint only and would still pass with the other seven states deleted.

### B-2 — AS-051's unused-class check does not recurse. [AS-051]
`lib/webflow-converter/convert.ts:47-49`

```ts
const usedClasses = new Set(
  (emitResult.payload.payload.nodes ?? []).flatMap((n) => n.classes ?? [])
);
```

`emit.ts:19` makes `children` a real nested tree. Only top-level nodes are
scanned. Probe:

```
convert('<section class="hero"><div class="container"><h1 class="hero-title">Hello</h1></div></section>',
        '.hero{display:flex}.container{max-width:1200px}.hero-title{color:#111}')
warnings: ["CSS class \"container\" is defined but not used by any HTML element",
           "CSS class \"hero-title\" is defined but not used by any HTML element"]
```

Both classes are used, and both are emitted as real styles in the same payload.
Every realistic document will drown the user in false warnings. The covering
test (`convert.test.ts:81-86`) uses a flat one-level document, so it cannot
catch this; the AS-141 test triggers the bug on its own markup but never asserts
`warnings`.

### B-3 — `allowEmptyNodes` makes AS-112 unenforceable, and a green test pins the violation. [AS-112, AS-119]
`lib/webflow-converter/convert.ts:85` and `lib/webflow-converter/validator.ts:169,190`

AS-112: "Every successfully converted payload's node list is non-empty."

```
convert("", "")  ->  errors: []   payload: non-null   payload.payload.nodes: []
```

That is, verbatim, a successfully converted payload with an empty node list.
`convert.test.ts:30-38` asserts this as the correct outcome, so the suite now
codifies the inverse of the contract — the same failure mode round 1 flagged at
`validator.test.ts:125`, relocated rather than removed. The validator-side test
(`validator.test.ts:204-213`) passes only because it calls `validatePayload`
without the option, i.e. it exercises a code path production never takes.

Note the inconsistency: `convert("<!-- nothing -->", "")` **does** error with
`payload.nodes must not be empty`, because the gate is keyed on the raw input
string being blank rather than on the outcome. The intended behaviour ("empty
input is not an error") needs a *new* assertion ID; AS-112 is immutable.

### B-4 — Synthetic `fake` styles make AS-114 unenforceable through the public entry point. [AS-114]
`lib/webflow-converter/convert.ts:69-93`

`convert()` builds placeholder styles for every unresolved class, validates
against a payload augmented with them, then returns `emitResult.payload` — the
**real, unaugmented** styles array. Probe:

```
convert('<div class="ghost"></div>', '')
errors: []   payload returned
payload.payload.styles: []
payload.payload.nodes[0].classes: ["ghost"]
```

The payload handed to the caller contains a class reference with no style
definition anywhere in it — exactly what AS-114 forbids. The rule is implemented
in `validator.ts:83-89` and tested at `validator.test.ts:215+`, but only against
hand-built payloads; no production path can ever reach it for a top-level node.

The hatch is also **inconsistent**, because `fakeStyles` is derived from the same
shallow `usedClasses` set as B-2. Nested classed elements are not covered by a
fake style, so they hit the real rule:

```
convert('<div class="outer"><p class="ghost">x</p></div>', '')
-> errors: ['Node ... references class "ghost" with no matching style definition'], payload: null
```

Identical markup succeeds at depth 0 and is hard-rejected at depth 1. Any
real-world "paste HTML now, CSS later" input containing a nested classed element
is refused outright. `convert.test.ts:20-28` misses this only because its nested
`<p>` happens to carry no class.

### B-5 — Combo chains of 3+ attach to the wrong base class. [AS-117]
`lib/webflow-converter/emit.ts:143-149`

`immediateBase` is `rec.comboOf[last]` — a bare class *name*. It is then
resolved with `idByKey.get(immediateBase)`, but `idByKey` is keyed by css.ts's
map key, where a combo is `"a|b"` and a standalone is `"b"` (`css.ts:173`). For a
three-level chain the name `"b"` resolves to the standalone `.b` style, not the
`.a.b` combo. Probe with `.a{} .a.b{} .a.b.c{}` on `<div class="a b c">`:

```
a  id cba1  comb ""    children [6494]   <- .a.b            correct
b  id 302c  comb ""    children [4587]   <- .a.b.c          WRONG: attached to standalone .b
b  id 6494  comb cba1  children []       <- real .a.b has no children
c  id 4587  comb 302c                    <- comb points at standalone .b
errors: []
```

No warning, no validation error — `validator.ts:144-153` only checks that the
`comb` id exists and is registered, both of which are true of the wrong parent.
`emit.ts:149`'s `?? ""` additionally converts an unresolvable base into a plain
base class silently. `emit.test.ts:131-140` uses only the degenerate 2-level case
where the standalone and combo keys coincide — it mirrors the implementation.

### B-6 — AS-118 is composite-failing, and has no realisation to test. [AS-118]
Because AS-041, AS-051, AS-112, AS-114 and AS-117 still violate, payloads that
break the contract are still returned as `errors: []` successes. Separately:
`grep -rn "webflow-converter"` outside the module returns only
`tests/unit/f004-webflow-tool-portal-isolation.test.ts:117` (a string match).
**There is no caller of `convert()` anywhere in the repo** — no copy button, no
clipboard write, no error surface. "Never offered for copy — the user sees an
error instead" is currently unimplemented; at library level `convert()` returning
`payload: null` is the necessary but not sufficient half.

---

## Non-blocking recommendations

**R-1 — AS-069 still holds by upstream accident.** The guarantee lives entirely
in `longhand.ts:397-563`. The AS-141 test's shorthand sweep is the only
payload-level check and covers one fixture. Also: `PASS_THROUGH`
(`longhand.ts:370-377`) is consulted *before* the shorthand vocabulary check and
contains `background-position` and `background-size`, which are shorthands under
CSS (`background-position-x/y`). They are emitted verbatim. Confirm whether that
is intended under the contract's definition of "shorthand".

**R-2 — AS-101's "JS-tab input" half does not exist.** `convert(html, css)` has
no JS parameter; there is no tab, no concatenation point, no test. Either the
tab arrives in M4/M5 and this is deferred, or AS-101 is only half-met.

**R-3 — AS-103's verbatim guarantee is untested.** All three external-script
tests use the canonical `<script src="X"></script>`. A mutant
``scripts.push(`<script src="${src}"></script>`)`` — which drops `async`,
`defer`, `type="module"`, `integrity`, `crossorigin`, `nomodule` — passes the
entire suite green. Add a case asserting byte-identical carry-through of
`<script async defer type="module" integrity="sha384-abc" crossorigin="anonymous" src="/a.js"></script>`,
plus a single-quoted and an uppercase variant.

**R-4 — The AS-119 tautology from round 1 survives unchanged.**
`convert.test.ts:115-132` is `if (errors.length > 0) expect(null) else expect(not null)`
on known-good input. Neither branch can fail; its own comment admits it declined
to construct a failing payload. No test anywhere constructs a deliberately-broken
input and asserts `convert()` returns `payload: null` — such inputs exist and do
behave correctly, they are simply unasserted.

**R-5 — Untested `js-extract` data-loss paths.** (a) A self-closing external
script swallows the next script: `<script src="/a.js"/><script>after</script>`
returns one mangled entry and `after` is lost entirely. (b) `</script>` inside a
string literal truncates silently, emitting corrupt JS with no warning. (c)
Scripts inside `<template>` are hoisted into custom code, turning inert markup
into executing code. (d) `src=""` is treated as inline. None warned, none tested.

**R-6 — `scripts[]` mixes two representations.** Inline entries are bare JS
bodies; external entries are full `<script ...>` tag markup. Any consumer that
joins the array produces invalid output for one or the other. Decide on one
representation before a consumer is written.

**R-7 — Duplicate style *names*.** `<div class="card is-featured">` with
`.card{} .card.is-featured{}` emits two styles both named `is-featured` (one
standalone, one combo) with different `_id`s. AS-116 is about identifiers so it
does not fire, but Webflow will see two classes with the same name. Worth a
decision.

**R-8 — `convert.ts:75` mints `fake-${cls}` style ids** with no collision check
against emitted ids. Not exploitable today (uuids), but it is an unchecked id
namespace inside the very function that validates id uniqueness.

---

## Recommended follow-up features

**FU-1 — Complete and correct the pseudo-state variant mapping.** In
`lib/webflow-converter/emit.ts`, extend `WebflowStyleVariants` and
`PSEUDO_STATE_TO_WEBFLOW` to cover all eight states AS-041 names, checking each
slot name against Webflow's real clipboard schema rather than guessing — in
particular replace the `placeholder: "nthChild"` mapping, which puts placeholder
declarations into the nth-child slot. Where Webflow genuinely has no slot for a
state (`:visited`, `::before`, `::after` may fall here), that needs a new
assertion recording the limitation, not a silent skip. Separately, stop
collapsing `"<breakpoint>_<state>"` keys into one flat slot: a `:hover` rule
inside `@media (max-width:991px)` must not overwrite the default-breakpoint
`:hover`. Add a test per state and a test proving a breakpoint-scoped state and
a default-breakpoint state coexist. Covers AS-041.

**FU-2 — Make the unused-class check recurse, and assert warnings in the
integration test.** Replace `convert.ts:47-49`'s single-level `flatMap` with a
recursive walk over `n.children`, and reuse that same walk for the `fakeStyles`
computation so the two never disagree. Add a test with a class used only on a
third-level descendant asserting *no* unused warning, and extend the AS-141
realistic-section test to assert `result.warnings` is empty — that assertion
alone would have caught this. Covers AS-051.

**FU-3 — Remove the `allowEmptyNodes` and `fakeStyles` escape hatches.** Delete
the `opts.allowEmptyNodes` parameter from `validator.ts` and its call site at
`convert.ts:85`, and delete the synthetic `fake: true` style injection at
`convert.ts:69-89`, so AS-112 and AS-114 are enforced on the payload the caller
actually receives. Delete `convert.test.ts:30-38`, which asserts that an empty
node list is a successful conversion, and add convert-level tests that feed
deliberately-broken input and assert `payload === null` with the specific error.
If "blank input should not be an error" and "HTML without CSS should still
convert" are genuinely desired product behaviours, they require **new** assertion
IDs and a design that does not weaken AS-112/AS-114 — for example returning a
distinct non-error `empty` result state, or emitting real (not synthetic) empty
styles into the returned payload so the class references genuinely resolve.
Covers AS-112, AS-114, AS-119.

**FU-4 — Fix combo parentage for chains of three or more.** In
`lib/webflow-converter/emit.ts`, key the base lookup on css.ts's composite map
key (`"a|b"`) rather than the bare trailing class name, so `.a.b.c`'s `comb`
points at the `.a.b` combo rather than the standalone `.b`. Replace the silent
`?? ""` fallback with a warning. Add a test using a three-level chain asserting
the full parent pointer chain and each `children` array, and add a validator rule
that a combo's declared `comb` base is itself consistent with the combo's class
chain. Covers AS-117.

**FU-5 — Harden the script-extraction tests and fix the silent-loss paths.**
Add tests that assert byte-identical carry-through of an external script tag
carrying `async`, `defer`, `type="module"`, `integrity` and `crossorigin`, plus
single-quoted and uppercase variants, so a re-serializing regression cannot pass.
Fix or warn on the self-closing `<script src="..."/>` case, which currently
swallows the following script entirely, and on `</script>` appearing inside a
string literal, which truncates silently. Decide whether `<template>`-nested
scripts should be hoisted. Settle on a single representation for the `scripts[]`
array (raw bodies vs. tag markup) before any consumer is written. Covers AS-101,
AS-103, AS-110.

**FU-6 — Build the copy surface that AS-118 and AS-119 describe.** Nothing in the
app calls `convert()` today, so "never offered for copy" has no implementation.
This feature wires the converter into the tool page: a copy action that is
disabled and shows the validation errors whenever `convert()` returns
`payload: null`, with no override affordance of any kind, and writes
`JSON.stringify(payload)` to the clipboard otherwise. Needs a component test that
a known-invalid input renders errors and leaves the copy control disabled.
Covers AS-118, AS-119, and completes the AS-101 "JS-tab input" half if the tab
lands in the same surface.

---

## Command output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  347 passed (347)
   Start at  22:46:06
   Duration  504ms (transform 289ms, setup 433ms, import 330ms, tests 82ms, environment 0ms)
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
AS112 empty:    convert("","")            -> errors []  payloadNull false  nodes []
AS112 comment:  convert("<!-- x -->","")  -> errors ["payload.nodes must not be empty"]  payloadNull true
AS114:          convert('<div class="nowhere"></div>',"") -> errors []  payloadNull false  styles []
AS114 nested:   convert('<div class="outer"><p class="ghost">x</p></div>',"")
                -> errors ['Node ... references class "ghost" ...']  payload null
AS051 nested:   ["CSS class \"container\" is defined but not used by any HTML element",
                 "CSS class \"hero-title\" is defined but not used by any HTML element"]
AS111 topkeys:  ["type","payload"]  type = @webflow/XscpData
AS091:          {"tag":"section","classes":["a"],"data":{"xattr":[{"name":"id","value":"hero"}]}}
AS089:          <style>.only{color:red}</style> -> styles [["only","color: red;"]]  nodes 1

AS041 per-selector variants on .btn:
  :hover          {"hover":{...}}
  :active         {"pressed":{...}}
  :focus          {"focused":{...}}
  :focus-visible  {}   warn "does not map to a Webflow state — skipped"
  :visited        {}   warn "does not map to a Webflow state — skipped"
  ::before        {}   warn "does not map to a Webflow state — skipped"
  ::after         {}   warn "does not map to a Webflow state — skipped"
  ::placeholder   {"nthChild":{...}}   no warning  <-- wrong slot

AS041 breakpoint+state collision:
  .btn:hover{color:red} @media(max-width:991px){.btn:hover{color:blue}}
  -> {"hover":{"styleLess":"color: blue;"}}   warnings []   <-- desktop hover lost

AS117 chain  <div class="a b c">  .a{} .a.b{} .a.b.c{}:
  a  id cba1  comb ""    children [6494]
  b  id 302c  comb ""    children [4587]   <-- .a.b.c attached to standalone .b
  b  id 6494  comb cba1  children []
  c  id 4587  comb 302c
  errors []

AS069:  .b{margin:0 auto;background:red url(x.png);font:12px/1.5 Arial}
  -> "font-family: Arial; font-size: 12px; line-height: 1.5; margin-bottom: 0;
      margin-left: auto; margin-right: auto; margin-top: 0;"
  warn [".b: shorthand 'background' is not supported — write longhands instead"]
```

### AS-118 consumer scan

```
$ grep -rn "webflow-converter" --include='*.ts' --include='*.tsx' app components lib hooks
lib/webflow-converter/*                      (module-internal only)
tests/unit/f004-webflow-tool-portal-isolation.test.ts:117   (string match in an isolation test)
```

No caller of `convert()` / `convertFromSource()` exists outside the module.
