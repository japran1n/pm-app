# M3 Scrutiny — Round 9

**Verdict: FAIL — 1 blocker (regression introduced by F092 / ba838e5f).**

Gates are green (387/387 tests, `tsc --noEmit` clean, `npm run lint` clean).
The failure is not a coverage gap: it is an observable defect on realistic
input that the new tests do not exercise.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-011 | PASS | Unchanged by F092; prior round confirmed correct code. |
| AS-041 | PASS | Longhand/shorthand expansion unchanged and exercised. |
| AS-051 | PASS | Unused-class warning walks full node tree incl. combo chains. |
| AS-069 | PASS | Unchanged by F092. |
| AS-089 | PASS | Inline `<style>` merged into parsed CSS before emit. |
| AS-091 | PASS | Unchanged by F092. |
| AS-101 | PASS | Scripts pass through to `customCode.scripts` at convert level. |
| AS-103 | PASS | js-extract behaviour unchanged. |
| AS-110 | PASS | Payload envelope shape correct. |
| AS-111 | PASS | Unchanged by F092. |
| AS-112 | PASS | Node `_id` uniqueness enforced. |
| AS-114 | PASS | Node `classes` resolve to style names. |
| AS-116 | **FAIL — blocker** | The F092 "fix" implements the wrong rule and rejects valid payloads. See below. |
| AS-117 | PASS | Combo parentage + `children` backfill verified empirically; skip path is defensive and effectively unreachable via `convert()` because `css.ts` synthesises the missing base. Mutation-killed by the emit tests. |
| AS-118 | PASS (tainted) | Error → `payload: null` gate works, but it is now firing on valid input because of the AS-116 blocker. |
| AS-119 | PASS | Non-empty `errors` ⇒ `payload === null`. |
| AS-141 | PASS | Realistic multi-element fixture converts and validates; still green. |

## Blocker

**B1 — AS-116 duplicate-name check rejects the canonical standalone + combo
pattern. Severity: blocker. File: `lib/webflow-converter/validator.ts:123-136`.**

AS-116 reads: *"No two style definitions in the same payload share the same
**identifier**."* The identifier of a Webflow style is `_id`, and that rule was
**already** enforced before F092 by the pre-existing
`Duplicate style _id found: ...` check at `validator.ts:114`. F092 added a
second, different rule — uniqueness of `name` — which the assertion does not
ask for and which contradicts the Webflow clipboard format: a combo style
legitimately carries the *bare* combo class name plus a non-empty `comb`
pointing at its base. `comb` is what disambiguates; `name` collisions are
expected and normal.

Empirically, on input any real stylesheet produces:

```
html: <div class="btn primary">x</div><div class="primary">y</div>
css : .primary{color:red} .btn{color:blue} .btn.primary{color:green}
```

the converter now returns:

```
payload: null
errors: ['duplicate style name "primary" (ids: 3cd5..., f21b...) — payload would produce ambiguous class references']
```

A utility class that also appears as a combo modifier (`.primary` /
`.btn.primary`, `.card` / `.section.card`, `.active` / `.nav-link.active`) is
one of the most common patterns in any hand-written or exported stylesheet.
F092 turned every such document into a total conversion failure with zero
output — a strictly worse outcome than the pre-F092 behaviour. AS-118 then
faithfully suppresses the copy, so the user sees an error for a perfectly
valid page.

The existing tests do not catch this because the added validator test
(`validator.test.ts`) constructs two styles with identical `name` and **both
`comb: ""`** — it mirrors the implementation's assumption rather than testing
the assertion's intent. No test in the suite pairs a standalone style with a
combo style of the same terminal class name.

Note also the justifying comment ("validator.ts resolves style references by
name, so a duplicate would be an ambiguous reference") is not a defect in the
payload — it is a limitation of the validator's own `styleNames` set at
`validator.ts:107`. The correct response is to make AS-114 resolution
combo-aware, not to reject the document.

## Recommended follow-up features

**F0xx — Restore combo-legal style-name handling in the validator.**
Remove the blanket `name`-uniqueness check added in ba838e5f from
`validateStyles` in `lib/webflow-converter/validator.ts`; AS-116 is about
`_id` and is already satisfied by the pre-existing duplicate-`_id` check. If a
name-collision rule is still wanted, narrow it so that it only fires when two
styles share the same `name` **and** the same `comb` value (i.e. genuinely
indistinguishable siblings), leaving `.primary` (comb `""`) and `.btn.primary`
(comb = id of `.btn`) as a legal pair. Add regression tests at the `convert()`
level, not the validator level: (a) `.primary` + `.btn` + `.btn.primary` with
markup using both must produce `payload !== null`, `errors === []`, exactly
three styles, and the combo's `comb` equal to `.btn`'s `_id`; (b) two styles
constructed with identical `name` *and* identical `comb` must still error; (c)
a three-deep chain `.a` / `.a.b` / `.a.b.c` where `b` also exists standalone
must validate. Each test must fail if the name check is reinstated
unconditionally.

**F0yy — Make node-class resolution (AS-114) combo-aware.**
`validateStyles` returns a flat `Set<string>` of style names which
`validateNodes` uses to check every entry of a node's `classes` array. With
duplicate names legal, that set is ambiguous by construction. Replace it with a
resolution that walks each node's `classes` array in order and matches against
the style graph using `comb`/`children` parentage, so that `["btn","primary"]`
resolves `primary` to the combo child of `btn` rather than to any style merely
named `primary`. Tests should cover: a node referencing a combo whose base it
does not also carry (should error), and a node carrying the full chain
(should pass).

---

## Gate output

### `npx vitest run lib/webflow-converter/`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  387 passed (387)
   Start at  00:07:13
   Duration  469ms
[exited with code 0]
```

### `npx tsc --noEmit`
```
(no output — exited with code 0)
```

### `npm run lint`
```
(no findings — exited with code 0)
```

### Adversarial probe (not committed; run ad hoc against `convert()`)
```
[A] standalone+combo   payloadNull=true  errors=['duplicate style name "primary" ...']
[B] unparented combo   payloadNull=false errors=[]  (css.ts synthesises empty .btn base; comb wired correctly)
[C] control            payloadNull=false errors=[]
```
