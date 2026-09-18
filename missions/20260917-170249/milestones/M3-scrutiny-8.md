# M3 Scrutiny — Round 8

Milestone: **M3 — Conversion engine: HTML / emit / validate**
Mission: `20260917-170249`
HEAD at review: `7c464cd2`
Reviewer: scrutiny validator (read-only; no code, test, or contract modified)

## Verdict: **FAIL** — 2 blockers, 8 majors

**F091's AS-116 fix does not hold.** It is not a root-cause fix; it is a
patch shaped to the single fixture round 7 published. The duplicate-`name`
violation is still live at HEAD `7c464cd2` on inputs that are *more*
realistic than the round-7 repro — including the canonical Webflow combo
pattern where a CSS file defines `.btn`, `.primary` and `.btn.primary`.

Reproduced against unmodified HEAD, not inferred. Gates are green and prove
nothing: `vitest` 386/386, `tsc --noEmit` clean, `eslint` clean.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|----|---------|----------|--------|
| AS-011 | **FAIL** | major | Page scan still matches **zero** files (`convert.test.ts:379` filters `entry.name`, but the page is `webflow/page.tsx`). Assertion is true in reality; the test is vacuous. Unchanged since round 6. |
| AS-041 | **PASS** | — | Carried from round 7; double-prefix mutant kills 2 tests. |
| AS-051 | **FAIL** | major | Warning produced, but no near-miss fixture; prefix-matching mutant silences it undetected. Coverage gap only. |
| AS-069 | **FAIL** | major | Two surviving mutants (`css.ts:187` state bypass, `longhand.ts:26` prefix narrowing). HEAD code is correct; invariant unenforced by validator. |
| AS-089 | **FAIL** | major | Only "no node" half tested, only for nested elements; top-level `<script>`/`<style>` unguarded by any assertion. |
| AS-091 | **FAIL** | major | All id tests use top-level elements; dropping nested ids keeps suite green. |
| AS-101 | **PASS** | — | Carried from round 7; orchestrator filter mutant killed. |
| AS-103 | **PASS** | — | Carried from round 7; attribute-stripping mutant kills 4 tests. |
| AS-110 | PASS | minor | Discriminating fixture kills list-concatenation reordering. |
| AS-111 | **FAIL** | major | Comparison exactness never pinned; case-insensitive mutant accepts `@WEBFLOW/XSCPDATA`. |
| AS-112 | **PASS** | — | Empty-array, null, non-object-entry all error. |
| AS-114 | **FAIL** | major | `validator.ts:83` fail-opens: `classes: "ghost"` (string, not array) validates clean with zero errors. Not emitter-reachable → major, not blocker. |
| AS-116 | **FAIL** | **blocker** | Duplicate style `name` still emitted with `errors: []` on ordinary combo CSS. F091 fix is fixture-shaped, not root-cause. |
| AS-117 | **FAIL** | **blocker** | A three-class combo whose base pair has no rule is emitted with `comb: ""` — not a child of anything, indistinguishable from a standalone class — behind a warning the validator never sees. |
| AS-118 | **FAIL** | **blocker** | Inherited: an invalid payload *is* returned non-null with `errors: []`. |
| AS-119 | **FAIL** | major | No escape hatch exists, but nothing pins that; an `allowInvalid` option can be added with the suite green. |
| AS-141 | **PASS** | — | Genuine end-to-end behavioural test. |

---

## Blockers

### B-1 / AS-116 + AS-118 — duplicate style `name` survives F091

F091 (`7c464cd2`) changed `css.ts:170` from registering *every* chain member
as a standalone class to registering only the **non-terminal** members:

```ts
for (let i = 0; i < chain.length - 1; i++) ensure(chain[i], chain[i], null);
```

That removes the *phantom* standalone only. It does nothing when the terminal
class has a real rule of its own — because that rule calls `ensure(c, c, null)`
itself, exactly as the new comment concedes. The combo entry keyed `btn|primary`
still carries `name: "primary"`, so both reach the styles array.

**Reproduced at HEAD `7c464cd2`.** Three surviving cases:

**Case B — the canonical Webflow combo stylesheet.**
```ts
convert('<div class="btn primary">x</div>',
        '.btn{color:blue}.primary{color:green}.btn.primary{color:red}')
```
→ `errors: []`, `payload !== null`, styles:
```
{ name: "btn",     comb: "",     _id: b277… }
{ name: "primary", comb: "",     _id: f1e9… }   <-- both named "primary"
{ name: "primary", comb: b277…,  _id: 2ec6… }   <--
```

**Case D — three-class chain, both duplicates non-combo.**
```ts
convert('<div class="a b c">x</div>', '.a.b.c{color:red}.b{color:blue}.c{color:green}')
```
→ `errors: []`, two styles named `"c"`, **both with `comb: ""`**. Totally
indistinguishable. Only a `warnings` entry, which does not gate anything.

**Case E — same combo written in both class orders.**
```ts
convert('<div class="btn primary">x</div>', '.primary.btn{color:red}.btn.primary{color:teal}')
```
→ `errors: []`, four styles: two named `"btn"`, two named `"primary"`.

Nodes reference styles **by `name`, not `_id`** (`validator.ts:44-46`, resolution
at `validator.ts:83-86`). So every one of these payloads contains an ambiguous
reference. `validator.ts:114` dedupes only `_id`; `style.name` is merely
accumulated into a `Set` at `validator.ts:119-120`, where collisions are
swallowed by Set semantics and never reported.

The durable half of round 7's FU-1 — **a duplicate-`name` check in
`validateStyles`** — was not implemented. That omission is why a fixture-shaped
emitter tweak was able to turn the suite green while the assertion stayed
violated. Any future emitter change can reintroduce this silently.

F091's regression test pins only the round-7 fixture (`.btn.primary` with no
standalone `.primary` rule). It is a point fix with a point test.

### B-2 / AS-117 — combos emitted un-parented, behind a warning

`emit.ts:171-181`: when a combo's base chain has no style entry, `comb` is left
`""`, a warning is pushed, and the style is emitted anyway. The validator's
`if (style.comb)` guard at `validator.ts:144` then skips it entirely, so a style
that *is* a combo by construction is accepted as a plain class.

Case D above is this on realistic input: `.a.b.c` is valid CSS and a legal
Webflow three-class combo, yet the emitted `"c"` combo is not a child of
anything and is byte-identical in shape to the standalone `"c"`. Applied in
Webflow, its declarations would bind to every element carrying class `c`, not
only to `a b c`. This is a visual-correctness defect, not a coverage gap.

Note that F091 slightly *widens* this path: `.a.b` is only registered when an
explicit `.a.b {}` rule exists, so `baseKey = "a|b"` misses more often than it
did before.

Also still open from round 7 and requiring no source edit: a self-referential
combo `{_id:"x", name:"x", comb:"x", children:["x"]}` validates clean.

### B-3 / AS-118 — inherited

`convert.ts:92-100` returns `payload: null` unconditionally on `!validation.valid`,
which is sound. But it is only as strong as the validator feeding it, and the
validator reports `errors: []` for all three cases above. An invalid payload is
returned non-null and would be offered for copy. (UI half is M5 scope and is
not discharged here.)

---

## Majors — carried from round 7, none escalated

Applying the escalation criterion *"a real defect observable in the running code
on realistic input"*, the remaining round-7 majors are all genuine **test
coverage gaps** at correct code, and correctly stay majors:

- **AS-089, AS-091** — HEAD emits/preserves correctly; only the mutants break it.
- **AS-069** — the `longhand.ts:26` vendor regex and `css.ts:187` state expansion
  are both right at HEAD; no shorthand escapes on real input. Unenforced by the
  validator, hence fragile.
- **AS-051** — near-miss class names untested; warning behaviour is correct today.
- **AS-111, AS-119** — contracts unpinned; current behaviour correct.
- **AS-011** — verified independently: `grep -rn supabase` across
  `app/(workspace)/w/[workspaceSlug]/tools/webflow/` returns nothing, so the
  assertion *holds*. The test that claims to prove it matches zero files. Third
  consecutive round vacuous.
- **AS-114** — `classes: "ghost"` fail-open is unreachable from the emitter
  (which always writes arrays), so it is robustness, not a live defect.

---

## Recommended follow-up features

**FU-A — Duplicate style `name` detection in the validator (blocker, do this
first and independently of any emitter change).** In `validateStyles`
(`lib/webflow-converter/validator.ts`, around lines 104-122), add a
name-collision check alongside the existing `_id` check: track each
`style.name` in a `Map<string, number>` and push an error such as
`Duplicate style name found: "<name>"` whenever a second definition claims a
name already taken. This must land *before* and *separately from* any emitter
change, because it is the invariant that makes the emitter fix verifiable —
round 7's blocker was closed by an emitter tweak alone and immediately
regressed on adjacent input. Tests must construct payloads directly (not via
`convert`) with two same-named styles and assert `valid === false`, so the
check cannot be defeated by future emitter behaviour.

**FU-B — Give combo styles a globally unique name in the emitter (blocker).**
`css.ts:167-180` keys combos by the pipe-joined chain but names them with the
bare terminal class, so `.btn.primary` and a standalone `.primary` both emit
`name: "primary"`. Choose one naming rule for combo entries and apply it
everywhere — the natural choice is for the combo entry's `name` to be derived
from its full chain key so it can never collide with a standalone class. Verify
against all three inputs that survive F091:
`.btn{}.primary{}.btn.primary{}`; `.a.b.c{}.b{}.c{}`; and
`.primary.btn{}.btn.primary{}` — each must produce zero duplicate names and,
with FU-A in place, `errors: []` genuinely meaning valid. Add each of the three
as a regression fixture; a single fixture is what allowed this to regress once
already.

**FU-C — Un-parented combos must be an error, not a warning (blocker).** At
`emit.ts:171-181`, when `idByKey.get(baseKey)` misses, the style is currently
emitted with `comb: ""` and only a warning, making a combo indistinguishable
from a standalone class and letting its declarations bind far too broadly.
Either synthesise the missing intermediate base style (so `.a.b.c` creates an
empty `.a.b` combo to parent onto) or push a hard error into `errors` so
`convert` returns `payload: null`. Additionally tighten `validator.ts:144` to
reject `style.comb === style._id` (self-referential combo) and to reject a
style whose name implies combo construction while `comb === ""`. Tests: the
`.a.b.c` case asserting the emitted `c` style has a non-empty `comb` pointing
at an `a.b` style, and a directly-constructed self-referential combo asserting
`valid === false`.

**FU-D — Carry forward round 7's FU-2 through FU-6 unchanged.** The
validator fail-open on non-array `classes` (AS-114), the payload-level
no-shorthand sweep plus `-ms-`/`-moz-`/`-o-` and pseudo-state shorthand
fixtures (AS-069), the nested-id and top-level-`<script>`/`<style>` emit tests
(AS-089, AS-091), the case-variant `type` test and the
`convert.length === 2` no-escape-hatch assertion (AS-111, AS-119), and the
AS-011 scan repair (match the full path for a `webflow` segment, assert
`webflowFiles.length > 0`, and check for `import ... from "...supabase"` /
`createClient(` rather than the bare word, which appears in an explanatory
comment). None of these are blockers; all are fragility.

---

## Full gate output

### `npx vitest run lib/webflow-converter/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  386 passed (386)
   Start at  00:00:57
   Duration  479ms (transform 311ms, setup 393ms, import 341ms, tests 84ms, environment 0ms)

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

Probe file `lib/webflow-converter/__probe.test.ts` was created, run, and
removed. `git status --porcelain lib/` is empty; HEAD unchanged at `7c464cd2`.
No code, test, or contract was modified.
