# M3 scrutiny — HTML / emit / validate engine (F015–F021)

**Result: FAIL**

Reviewed read-only. Nothing in the repo was modified. Findings below come from
reading the code, from two independent parallel reviewers given only the
assertion text and the file list, and from live probes of `convert()` run in a
throwaway test file (deleted; `git status` confirms no working-tree change to
`lib/`).

Lint, typecheck and the full suite are **green** (329/329 converter tests). That
is precisely the problem: the suite is green *while five payload-validity
assertions are unimplemented*, and in two places the tests assert the opposite
of the contract.

---

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | PASS | No Supabase import anywhere in `lib/webflow-converter/`; `convert.test.ts:126` scans every non-test source file for the string. Genuine guard. |
| AS-041 | FAIL (blocker, B-7) | `:hover` parsed by `css.ts` then discarded by `emit.ts:101-110`; no state variant reaches the payload and no warning is raised. |
| AS-047 | PASS | `emit.ts:147-149`; tested at `emit.test.ts:79`. |
| AS-051 | FAIL (blocker, B-8) | Probe: `convert('<div class="used">', '.used{...}.unused{...}')` returns zero warnings. No defined-but-unreferenced check exists anywhere. |
| AS-069 | PASS (major, R-1) | Holds only because `css.ts`/`longhand.ts` expand upstream. Neither `emit.ts` nor `validator.ts` contains a shorthand check, and no test asserts absence of shorthand in emitted `styleLess`. F020's own spec required this check. |
| AS-077 / AS-078 / AS-079 / AS-080 / AS-081 | PASS | `typemap.ts:48-99`, tested `typemap.test.ts:6-56`. AS-079's loop over h1–h6 is a real guard. |
| AS-082 / AS-083 | PASS | `typemap.ts:103-105`; branch driven by caller's `hasElementChildren`, supplied correctly at `emit.ts:151-158`. |
| AS-084 | PASS | `typemap.ts:107-115`, warning asserted at `typemap.test.ts:105`. |
| AS-085 | PASS | `typemap.ts:149-159`. |
| AS-086 | PASS | `typemap.ts:133-140` carries `outerHTML` verbatim; `emit.ts:180` short-circuits the subtree. Probe confirms `<circle>` produces no child node. |
| AS-087 / AS-088 | PASS | `typemap.ts:142-166`. AS-087's test only asserts `toBeTruthy()` on the warning — low resolution but not a mirror. |
| AS-089 | FAIL (blocker, B-3) | Node half passes (`emit.ts:64,142`). Extraction half fails: `convert()` never feeds body `<style>` CSS into `parseCss`; it lands in `customCode.styles` and is styling-dead. |
| AS-090 | PASS | `emit.ts:162`. |
| AS-091 | FAIL (blocker, B-4) | `id` is in `RESERVED_ATTRS` (`emit.ts:68`) and is never written to the node. Probe: `<section id="hero">` emits no `id` anywhere. `emit.test.ts:60` *asserts* `id` is absent — the suite locks in the violation. |
| AS-092 | PASS | `emit.ts:133-137`. Probe confirms exact name/value including mixed case. |
| AS-093 | PASS (minor) | True only as a side effect of the `data-`-only whitelist; the `!RESERVED_ATTRS.has(name)` clause at `emit.ts:135` is dead code. Test mirrors implementation. |
| AS-094 | PASS | `emit.ts:151-153,182-185`, tested `emit.test.ts:29,71`. |
| AS-095 / AS-096 / AS-097 / AS-098 / AS-100 | PASS | `typemap.ts:117-131`. AS-097's `not.toHaveProperty("alt")` is a real intent test. |
| AS-099 | PASS (major, R-2) | `typemap.test.ts:152` strips `warning` and stringifies the rest — good. But it checks only `getWebflowType`'s return, not the assembled payload. Probe on full `convert()` confirms the src is absent. |
| AS-101 | FAIL (blocker, B-1) | External `<script src>` is *not* collected. `js-extract.ts:35-39` `continue`s past it. |
| AS-102 | PASS | `convert.ts:41-44` keeps `customCode` outside `payload`. |
| AS-103 | FAIL (blocker, B-1) | Contract: external `src` tags "carried into the custom-code output unchanged, with no allowlist restriction and no stripping." Implementation drops them and warns. |
| AS-104 / AS-105 / AS-134 | PASS | `js-extract.ts:41-47` is pure passthrough; no GSAP detection, no CDN injection. |
| AS-107 | PASS | Empty `scripts` array when no scripts. |
| AS-108 | PASS | Probe: HTML+CSS with no JS converts successfully. |
| AS-109 | INCONCLUSIVE | Page-level guidance; not implementable in the engine. Deferred to the M4/M5 page feature. |
| AS-110 | FAIL (blocker, B-1) | Probe: `<script>A</script><script src=x></script><script>B</script>` yields `["A","B"]`. Order of the *source* sequence is not preserved because item 2 is deleted. |
| AS-111 | FAIL (blocker, B-2) | The string `@webflow/XscpData` does not exist anywhere in the repo. `emit.ts:212-222` emits `{payload:{...}}` with no `type`. Probe: `Object.keys(payload) === ["payload"]`. Webflow will reject this paste. |
| AS-112 | FAIL (blocker, B-2) | `validator.ts:111-115` accepts `nodes: []`. Probe: `convert("","")` returns `errors: []` and a zero-node payload as a success. `validator.test.ts:125` asserts *"empty nodes array is a valid empty document"* — the suite codifies the inverse of the contract. |
| AS-113 | PASS (vacuous, minor) | Children are inlined objects, not id refs, so resolution cannot fail by construction. No validation exists; if the format is ever changed to Webflow's real `children: string[]`, nothing catches it. |
| AS-114 | FAIL (blocker, B-2) | `validator.ts` never reads `node.classes`. Probe: `<div class="nowhere">` with empty `styles` validates clean. |
| AS-115 | PASS (major, R-3) | Implemented at `validator.ts:55-59`, but **untested** — no duplicate-id test exists. Deleting the `seenIds.has` branch keeps the suite green. |
| AS-116 | FAIL (blocker, B-2) | `validateStyles` (`validator.ts:74-93`) has no style-id set and no dedupe. |
| AS-117 | FAIL (blocker, B-5) | `emit.ts:121` hardcodes `children: []` on every style. Probe: the combo carries `"comb": "card"` while base `card` has `"children": []` — the combo is orphaned. Validator does not check it either. |
| AS-118 | FAIL (blocker, B-2) | The gating *mechanism* is sound (`convert.ts:47-56`, no bypass), but because AS-111/112/114/116/117 are unimplemented, violating payloads pass and are offered for copy. |
| AS-119 | PASS (major, R-4) | `validator.ts:124` `valid: errors.length === 0`; `convert.ts:47-56` returns `payload: null` on failure; no override flag anywhere in the repo. But **both** its tests are tautologies: `validator.test.ts:152` restates `errors.length === 0`, and `convert.test.ts:92-98` is `if (errors.length > 0) expect(null) else expect(not null)` — a branch that can never fail. |
| AS-120 | PASS | `convert.ts:58-63` returns merged warnings alongside a successful payload; tested `convert.test.ts:100`. |
| AS-129 | PASS | Pure function, no I/O of any kind. |
| AS-141 | FAIL (blocker, B-6) | No test exists for a realistic section with a combo class, a hover state and two breakpoints. The nearest (`convert.test.ts:55`) feeds `.box:hover` and then asserts only that the base `color: blue` survived — it steps directly over the fact that the hover variant was silently discarded. Textbook test-mirrors-implementation. |

---

## Blockers

**B-1 — External scripts are dropped instead of carried. [AS-101, AS-103, AS-110]**
`lib/webflow-converter/js-extract.ts:35-39`. AS-103 is explicit: external `src`
tags are "carried into the custom-code output unchanged, with no allowlist
restriction and no stripping"; AS-101 says "inline bodies and external `src`
tags alike." F019's own spec repeats this. The implementation warns and
`continue`s, so a GSAP CDN tag vanishes and the surviving scripts execute in an
order that no longer matches the source. Note for the orchestrator: the M3 task
brief handed to this validator stated the opposite ("external scripts produce
warnings, not inclusions"). The validation contract is immutable and wins; if
the intent really has changed, that needs a **new** assertion ID, not a
reinterpretation of AS-103.

**B-2 — `validatePayload` implements roughly a third of its spec. [AS-111, AS-112, AS-114, AS-116, AS-118]**
`lib/webflow-converter/validator.ts:103-128`. F020's spec required: "type check,
non-empty nodes, unique node/style ids, every child/class reference resolves,
known-type check, combo-class-registered-as-child check, no-shorthand check."
Delivered: unique *node* ids, known-type warning, class-name regex, cycle
detection, array-shape checks. Missing: the payload `type` check, non-empty
nodes, class→style resolution, unique style ids, combo-child registration, and
the shorthand check. Because AS-118 is defined as "a payload violating any of
AS-111–AS-117 is never offered for copy," the gap in the validator is itself the
AS-118 failure.

**B-3 — `convert()` loses inline `<style>` CSS. [AS-089, AS-015]**
`lib/webflow-converter/convert.ts:31-45`. The primary entry point extracts body
`<style>` content into `customCode.styles` and never passes it to `parseCss`.
Probe: `<style>.inline-only{color:red}</style>` produced zero styles for
`.inline-only`. Only `convertFromSource` (`convert.ts:70-74`) merges them, and
it ignores the caller's `css` argument entirely, so there is no path that
combines a CSS tab with inline `<style>` blocks. AS-089 requires the CSS go
"into the style model."

**B-4 — `id` attributes are silently destroyed. [AS-091]**
`lib/webflow-converter/emit.ts:68` and `:133-137`. `id` sits in
`RESERVED_ATTRS`, is excluded from `xattr`, and is never written anywhere else
on the node. `emit.test.ts:60` affirmatively asserts its absence, so the suite
protects the bug.

**B-5 — Combo classes are never registered under their base. [AS-117]**
`lib/webflow-converter/emit.ts:121` hardcodes `children: []` for every style
while `:116` sets `comb`. Webflow requires the base style's `children` array to
contain the combo's `_id`; without it the combo is orphaned on paste. Neither
emitted nor validated.

**B-6 — AS-141's realistic-section test does not exist. [AS-141]**
`lib/webflow-converter/convert.test.ts` contains no case with nested containers
+ heading + link + list + combo class + hover state + two breakpoints, asserting
a clean validation. The closest case asserts only that a base declaration
survived, and would keep passing with the hover variant fully deleted — which is
exactly what happens today.

**B-7 — Pseudo-state variants are parsed and then thrown away. [AS-041, AS-069]**
`lib/webflow-converter/emit.ts:101-110` whitelists breakpoint keys only, with an
inline comment conceding state variants are "out of scope." `css.ts:176-177`
already produced them. They are dropped with no warning, so the user sees a
successful conversion that has silently lost every hover/focus/`::before` style.

**B-8 — No defined-but-unreferenced class warning. [AS-051]**
Assigned to F018, implemented nowhere. This check needs both the HTML class set
and the CSS class set, so `css.ts` structurally cannot do it and `emit.ts` is
the only place it can live.

---

## Recommendations (non-blocking)

**R-1 — Add a shorthand assertion at the payload boundary.** AS-069 currently
holds by upstream accident. A single test that runs a realistic stylesheet
through `convert()` and asserts no emitted `styleLess` (base *or* variant) matches
`isShorthand` would make the assertion self-defending. Related: probing showed
an unexpanded shorthand's value is *dropped entirely* rather than preserved —
worth confirming that is intended.

**R-2 — Assertion IDs in test names are systematically wrong.** In
`validator.test.ts` every label is off by one or more (AS-111→empty-id,
AS-113→unknown type, AS-114→missing type, AS-116→styleLess type, AS-117→circular
refs, AS-118→empty nodes); `emit.test.ts` is similarly shifted. A traceability
audit reading test names alone would conclude AS-111–AS-118 are covered when five
are not implemented at all. This mislabelling is likely how M3 reached "complete."

**R-3 — Untested implemented branches.** AS-115's duplicate-id detection,
`makeId`'s counter fallback (`emit.ts:70-79`, module-level counter that never
resets), and `<img srcset>` with no `src` (which emits "(no src)" and loses the
only URL the user needs, defeating AS-098's intent) all lack tests.

**R-4 — Replace the two tautological AS-119 tests.** Neither can fail. A real
test constructs a payload known to violate a validator rule, passes it through
`convert()`, and asserts `payload === null` plus non-empty `errors`.

**R-5 — Non-`data-` attributes are silently discarded** (`aria-*`, `role`,
`type`, `rel`, `title`). Not required by any assertion, but it is fidelity loss
with no warning; worth a decision.

---

## Recommended follow-up features

**FU-1 — Complete the payload validator.** Extend
`lib/webflow-converter/validator.ts` to cover the five unimplemented rules from
F020's spec: assert the payload carries `type: "@webflow/XscpData"`; reject an
empty `nodes` array as an error; verify every name in a node's `classes` array
resolves to a `styles` entry; detect duplicate style `_id`s alongside the
existing duplicate node-id check; and verify that every style with a non-empty
`comb` appears in the `children` array of the base style it names. Each rule
gets a test that constructs a deliberately-broken payload and asserts the
specific error, plus a test that the corresponding `convert()` call returns
`payload: null`. Delete `validator.test.ts`'s "empty nodes array is a valid empty
document" case, which asserts the inverse of AS-112, and correct the assertion
IDs in every test name in the file. Covers AS-111, AS-112, AS-114, AS-116,
AS-118.

**FU-2 — Emit the Webflow payload envelope and combo-class parentage.** In
`lib/webflow-converter/emit.ts`, add the `type: "@webflow/XscpData"` field to the
emitted object (and the `XscpData` interface) so the payload is actually
pasteable into the Designer, and populate each base style's `children` array
with the `_id` of every combo style whose `comb` names it — `buildStyles` already
has both the id map and `comboOf`, so this is a second pass over
`cssResult.order`. Add tests that assert the envelope field on a real
`convert()` result and that a `.card.is-featured` input produces a base `card`
style whose `children` contains the combo's id. Covers AS-111, AS-117.

**FU-3 — Carry external scripts into custom code.** Change
`lib/webflow-converter/js-extract.ts` so an external `<script src="...">`
contributes its original tag markup to the `scripts` array in source position
rather than being skipped, per AS-103's "carried into the custom-code output
unchanged, with no allowlist restriction and no stripping." An advisory warning
may remain, but it must accompany the inclusion, not replace it. Add a test that
interleaves inline and external scripts and asserts the output array length and
ordering match the source sequence exactly. Covers AS-101, AS-103, AS-110.

**FU-4 — Preserve `id` attributes and state variants through emit.** Two losses
in the same walk: write the element's `id` onto the emitted node (Webflow's node
shape carries it in `data.xattr` or a dedicated field — confirm against the
reference prototype) instead of dropping it via `RESERVED_ATTRS`, and stop
discarding `_hover`/`_focus`/`_pressed`/`::before` variant buckets at
`emit.ts:101-110` by mapping them onto Webflow's state-variant slots. Remove
`emit.test.ts:60`'s assertion that `id` is absent from the node, which currently
protects the bug. Add tests asserting an `id` round-trips and that a
`.btn:hover` rule produces a reachable hover variant in the emitted style.
Covers AS-091, AS-041.

**FU-5 — Merge inline `<style>` CSS into the style model and warn on unused
classes.** In `lib/webflow-converter/convert.ts`, concatenate the body's
extracted `<style>` content with the caller's `css` argument before calling
`parseCss`, so inline styles become real Webflow classes rather than dead
`customCode.styles` text — and make `convertFromSource` a thin wrapper over that
same path instead of a divergent second implementation. Separately, after emit,
diff the set of class names referenced by nodes against the set defined in the
parsed CSS and emit a warning for each defined-but-unreferenced class. Covers
AS-089, AS-015, AS-051.

**FU-6 — Add the AS-141 realistic-section integration test.** One test in
`convert.test.ts` that feeds a section containing nested containers, a heading, a
link, a `<ul>` with list items, at least one combo class, at least one `:hover`
rule and at least two `@media` breakpoints, then asserts: `errors` is empty, the
payload carries the correct `type`, node count and style count are what the
fixture implies, the combo appears in its base's `children`, the hover variant is
present, both breakpoint variants are present, and no emitted `styleLess`
contains a shorthand property. This test is the one that would have caught most
of B-2 through B-7. Covers AS-141, and defends AS-069, AS-041, AS-117.

---

## Command output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  329 passed (329)
   Start at  22:18:00
   Duration  470ms (transform 268ms, setup 395ms, import 293ms, tests 76ms, environment 0ms)
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

### Supabase scan (AS-011)

```
$ grep -rn "supabase\|createClient" lib/webflow-converter/
lib/webflow-converter/convert.test.ts:131:      expect(contents.toLowerCase()).not.toContain("supabase");
```

### Live probe of `convert()` (abridged)

```
ERRORS []
WARNINGS ["img element for https://ex.com/a.png left empty — upload manually.",
          "external script 'https://cdn/gsap.js' not included — add manually in Webflow custom code"]
CUSTOMCODE {"scripts":["console.log(1)"],"styles":[".inline-only{color:red}"]}
PAYLOAD_TOPKEYS ["payload"]                      <-- AS-111: no "type" field
node for <section id="hero">: {"classes":["card","is-featured"],
  "data":{"xattr":[{"name":"data-x","value":"1"}]}}   <-- AS-091: id gone
style "card":        {"comb":"", "children":[]}       <-- AS-117: combo orphaned
style "is-featured": {"comb":"card", "children":[]}
style "btn":         {"styleLess":"", "variants":{}}  <-- AS-041: :hover discarded
.inline-only: absent from styles entirely            <-- AS-089/AS-015

EMPTY   convert("","")  -> errors: [] nodes: []       <-- AS-112
CLASSREF convert('<div class="nowhere">',"") -> errors: [] styles: []   <-- AS-114
AS051   convert('<div class="used">','.used{}.unused{}') -> warnings: []
AS110   scripts -> ["A","B"] (external tag dropped from the middle)
```
