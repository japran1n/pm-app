# M3 Scrutiny — Round 11

**Verdict: FAIL — 1 blocker (escalated), 3 majors.**

All three round-10 blockers (B1, B2, B3) are **resolved and verified
empirically**, not just by reading the diff. F094 and F095 do what they
claim. However, the AS-114 fix changed the converter's failure posture from
**fail-closed** to **fail-open**, and that turns round-10's M2 (AS-089) from
a major into a blocker: a malformed `<style>` block now silently produces a
structurally valid, completely unstyled payload that the user will copy into
Webflow, instead of an error that stops them.

Gates: `lib/webflow-converter` **393/393 pass**; `npx tsc --noEmit` exit 0;
`npm run lint` exit 0 with zero output. (Full-repo `npm test` still has the
pre-existing `tests/integration/**` `fetch failed` Supabase network failures,
unrelated to M3.)

## Blocker verification (round 10 → round 11)

Probes run through `convert()` (not through the unit-level seams the worker
tested), scratch harness at
`/private/tmp/claude-501/.../scratchpad/probe.test.ts`:

| Round-10 blocker | Repro | Round-11 result |
|---|---|---|
| B1 — stale `idByKey` → dangling `comb` | `.a{} .a.b.c{} .a.b.c.d{}` + `<div class="a b c d">` | **CLEARED.** `errors: []`, payload non-null. Chain `a → b(stub) → c → d`, every `comb` resolves and every combo is in its base's `children`. |
| B2 — missing intermediate → null payload | `.a{} .a.b.c{}` + `<div class="a b c">` | **CLEARED.** `errors: []`; `.a.b` synthesized with `styleLess:""`, `comb` = a's id; `.a.b.c` keeps `color: blue;`. No warning (correct — nothing was lost). |
| B3 — unstyled class → null payload | `<div class="wrapper w-container">` + `.wrapper{color:red}` | **CLEARED.** `errors: []`; `w-container` emitted as `styleLess:""` stub, no spurious AS-051 warning. Tailwind-style input (`flex items-center gap-2 text-sm`, zero CSS) also converts cleanly. |

The fix is implemented by construction, not by rejection — the right shape.
Lazy `idByKey` assignment (`emit.ts:123`, `227-228`) means only pushed styles
are registered, and `emit.ts:222` additionally deletes on the skip path.
Both belt and braces; correct.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-051 | **FAIL — major** | Unchanged from round 10. `<svg><path class="icon-path"/></svg>` + `.icon-path{fill:red}` → warning `CSS class "icon-path" is defined but not used`. `walkElement` returns at `emit.ts:317` before descending into svg, so no class inside a skipped subtree is ever collected. Still untested. |
| AS-052 | PASS (improved) | Newly satisfied by the F094 stub pass: an HTML-only class survives under its exact source name with `styleLess: ""`. Previously this path nulled the payload. |
| AS-089 | **FAIL — blocker (escalated)** | `<div class="good">x</div><style>.bad{color:</style>` + `.good{color:red}` now returns a **non-null, error-free payload in which `good` has `styleLess: ""`** — every declaration from every CSS source is gone, replaced by stubs. The only signal is one warning, `CSS parse error: Unclosed block`, which names neither the offending block nor the consequence. Round 10 rated this major because it failed closed (`payload: null`). After F094 it fails **open**: the user gets a plausible-looking payload, copies it, and pastes an entirely unstyled section into the Designer. Cause is unchanged: `convert.ts:49` string-joins all CSS sources before a single `parseCss`, and `css.ts:106-110` returns an empty class map on `CssSyntaxError`. |
| AS-114 | PASS | Every node class now resolves by construction (`emit.ts:362-383`). Verified across unstyled utilities, deep descendants, Tailwind input, and all combo-repair cases. See major MJ-1 for the residual name-shadowing hole. |
| AS-116 | PASS | `_id` uniqueness holds; synthesized stubs take fresh `makeId()` ids. Duplicate style *names* (standalone `b` + combo `b`) are expected and were explicitly ruled legitimate in round 9 — do not re-add name-uniqueness. |
| AS-117 | PASS | Every `comb` in every probe resolved to a style present in the same array, and every combo appeared in its base's `children` (second pass, `emit.ts:243-251`). The one genuinely unrepairable case (`.a{} .a.b.c.d{}`, two missing intermediates) degrades to warn-and-skip with a visible warning and a non-null payload — AS-117 holds, at the cost of losing the combo's declarations (see MJ-2). |
| AS-118 | INCONCLUSIVE | `convert.ts:92-100` nulls the payload on any error and is tested, but there is still no consumer: `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` is a placeholder and nothing imports `convert`. "The user sees an error instead" is unverifiable until M6. Note the AS-089 blocker means the *opposite* failure now exists — an invalid-in-substance payload that is offered for copy. |
| AS-119 | INCONCLUSIVE | Same missing consumer. The three AS-119 tests still restate `errors.length > 0 ⇒ valid === false`, which is the literal definition at `validator.ts:194` / `convert.ts:92`. Tautological; cannot fail except by deliberate inversion. Unchanged from round 10. |
| AS-120 | PASS | Warnings from `cssMap`, the walk, and `buildStyles` are all carried onto the successful result (`emit.ts:346`, `360`). Verified: the skip-path warning co-exists with a non-null payload. |
| AS-135 / AS-136 / AS-137 / AS-138 | PASS | 393 converter tests run under the repo's `vitest` config with no separate command; lint and `tsc --noEmit` both exit 0. |
| AS-141 | PASS | `convert.test.ts:227-336` unchanged and still genuinely falsifiable. |

Assertions PASSed in round 10 and not touched by F094/F095 (AS-011, AS-041,
AS-069, AS-091, AS-101, AS-103, AS-110, AS-111, AS-112) are carried forward
unchanged; re-probing found no regression from either commit.

## Test-quality judgement on the new tests

The F095 tests are unusually good for a fix commit: they do not merely assert
the new literals, they assert the *invariant* (`for (const s of styles) if
(s.comb) expect(ids.has(s.comb)).toBe(true)`) at both the `emit` and
`convert` levels, plus a negative assertion that the skip warning does **not**
fire. Those would fail under a mutant that re-introduced the stale-id bug.
The F094 tests are weaker — they assert `styleLess === ""` and name presence,
which mirrors the implementation, but the `convert()`-level
`errors).toEqual([])` assertion makes them falsifiable against the old
behaviour. Both acceptable.

One test I regard as mis-labelled:
`test_AS_117_truly_broken_three_level_chain_gracefully_skips_with_warning_not_null_payload`
codifies data loss as the expected behaviour. The synthesis in
`emit.ts:189-208` is arbitrarily limited to one level for no stated reason —
a loop would handle any depth. The test locks the limitation in.

## Blocker

**B4 — AS-089: one malformed `<style>` block silently discards every
declaration from every CSS source, and the result is now offered for copy.**
Severity: blocker (escalated from round-10 M2 by the F094 fail-open change).
Fail-open with a terse warning is worse for this product than fail-closed:
the user's feedback loop is a paste into the Webflow Designer, where "all my
styles vanished" is expensive to diagnose.

## Majors

**MJ-1 — AS-114 name shadowing.** `<div class="btn primary">` +
`<div class="primary">` with only `.btn{}` and `.btn.primary{}` defined:
the second node's `primary` class resolves — by name — to the *combo* style,
so no standalone stub is emitted. AS-114 is satisfied literally but the
payload is semantically wrong (a bare element referencing a combo). The stub
pass at `emit.ts:366` should key on standalone styles (`comb === ""`), not on
the full name set. I am deliberately not calling this a blocker: it is the
same terrain as the round-9 name-uniqueness regression and must be fixed by
*adding a stub*, never by adding a uniqueness error.

**MJ-2 — combo synthesis is capped at one level (`emit.ts:189-191`).**
`.a{} .a.b.c.d{}` and `.a{} .a.b{} .a.b.c.d.e{}` both drop the deepest
combo's real declarations. The warning is visible, so this is a major, not a
blocker — but the cap is arbitrary.

**MJ-3 — `walkNodes` silent skips (`validator.ts:56`, `validator.ts:83`).**
Unchanged. A non-array `children`, or `classes` as a string, causes the
validator to return `valid: true` on malformed input. No tests.

**MJ-4 — `<script>` nested inside `<svg>` is double-emitted.** Confirmed:
`<svg><script>alert(1)</script></svg>` yields `data.html` containing the
script verbatim **and** `customCode.scripts: ["alert(1)"]`. Executes twice on
paste. Arguably an AS-089 violation as well as a correctness bug.

## Minors

- The AS-051 warning leaks the internal pipe-joined combo key into
  user-facing text: `CSS class "x|b" is defined but not used by any HTML
  element`. Should read `.x.b`.
- Inherited from round 10 and still open: the AS-011 guard test only scans
  files whose *filename* contains "webflow" (the real route file is
  `page.tsx`); `!RESERVED_ATTRS.has(name)` in `buildXattr` (`emit.ts:263`) is
  a dead branch; `id=""` is dropped by the truthiness check at `emit.ts:301`;
  AS-111/AS-119 `convert()`-level tests are mirrors.

## Recommended follow-up features

**FU-D — parse each CSS source independently so one bad block degrades
gracefully (AS-089, blocker).** Change `convert.ts:49` so that the `css`
argument and each `<style>` block extracted from the HTML are passed through
`parseCss` separately and their class maps merged in source order, rather
than string-joined and parsed once. A `CssSyntaxError` in one source must
become a warning that names the source ("inline `<style>` block 2") and, if
postcss reports one, the line/column — and the remaining sources must still
produce their styles. Additionally, when a CSS source fails to parse at all,
the conversion should surface this prominently enough that the user cannot
mistake the result for a clean conversion; at minimum the warning text must
state that declarations were dropped. Tests: `<div class="good">x</div>
<style>.bad{color:</style>` with `.good{color:red}` must produce a payload in
which `good` still carries `color: red;` and a warning naming the bad block;
and the legacy `<style><!-- ... --></style>` comment-wrapped form must not
poison the other sources either.

**FU-E — stub standalone classes shadowed by a combo of the same name
(AS-114, major).** In the stub pass at `emit.ts:362-383`, build the
"already covered" name set from styles with `comb === ""` only, so that a
class whose only definition is a combo still receives its own standalone stub
style. Test: `.btn{} .btn.primary{}` with `<div class="btn primary">` and
`<div class="primary">` must produce a standalone `primary` style with
`comb: ""` in addition to the combo, both nodes must validate, and the combo
must remain in `btn`'s `children`. Do not add any error or uniqueness check —
this must be fixed purely by emitting an extra style.

**FU-F — recursive combo-chain synthesis (AS-117, major).** Replace the
one-level synthesis at `emit.ts:189-208` with a loop that walks the
`comboOf` prefix chain from the shallowest missing ancestor down, creating a
stub for each missing intermediate and chaining each under the previous, so
that a combo's declarations are never dropped regardless of how many
intermediates are absent. The warn-and-skip path then becomes genuinely
unreachable and its test should be replaced by one asserting `.a.b.c.d{}`
defined alone produces a full `a → b → c → d` chain with `color: yellow` on
`d`.

**FU-G — collect classes from skipped subtrees for the AS-051 usage check
(AS-051, major).** Before returning early for an `svg → HtmlEmbed`
(`emit.ts:317`) — and for any other `SKIPPED_TAGS` subtree — scan the raw
markup for `class` attributes and record those names in a "seen in HTML" set
used solely by the defined-but-unused check, without creating nodes or
stubs. Tests: `.icon-path{fill:red}` with `<svg><path class="icon-path"/>
</svg>` must produce no "defined but not used" warning, while a class defined
in CSS and genuinely absent from the whole document still warns.

**FU-H — harden `walkNodes` against malformed shapes (MJ-3, major).**
`validator.ts:56` and `validator.ts:83` must push an error rather than return
or skip when `children` is a non-array truthy value or `classes` is not an
array. Tests must feed hand-built malformed payloads and assert
`valid === false`.

**FU-I — do not extract `<script>` from inside an embedded subtree (MJ-4,
major).** `js-extract.ts` should skip `<script>` elements that have an
ancestor which `emit.ts` renders as an `HtmlEmbed` (currently `svg`), since
that markup is already carried verbatim in `data.html`. Test:
`<svg><script>alert(1)</script></svg>` must yield exactly one copy of the
script — in `data.html` — and an empty `customCode.scripts`.

---

## Gate output

### `npx vitest run lib/webflow-converter`

```
 Test Files  9 passed (9)
      Tests  393 passed (393)
   Duration  479ms
```

### `npx tsc --noEmit`

```
(no output)
TSC_EXIT=0
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

LINT_EXIT=0
```

### Adversarial probe output (via `convert()`)

```
=== B3 unstyled utility
errors: []   warnings: []
styles: [wrapper "color: red;" comb:""], [w-container "" comb:""]

=== B1 4-level missing mid  (.a{} .a.b.c{} .a.b.c.d{})
errors: []   warnings: []
styles: a(73a6, ch[18e8]) | b(29a6 stub) | b(18e8 comb 73a6, ch[0cad])
        | c(0cad comb 18e8 "color: blue;", ch[88c1]) | c(0b9b stub)
        | d(88c1 comb 0cad "color: green;")

=== B2 missing intermediate  (.a{} .a.b.c{})
errors: []   warnings: []
styles: a(a727, ch[645c]) | b(6996 stub) | b(645c comb a727 "")
        | c(5413 comb 645c "color: blue;")

=== two missing intermediates  (.a{} .a.b.c.d{})
errors: []
warnings: ["combo class \"d\" references base \"a.b.c\" which has no style definition — cannot emit combo"]
styles: a "color: red;" | b "" | c "" | d ""      <-- color: green LOST

=== no base at all  (.a.b{})
errors: []   warnings: []
styles: a(6a8f "" ch[f6ee]) | b(f6ee comb 6a8f "color: red;")

=== standalone name shadowed by combo  (.btn{} .btn.primary{})
errors: []   warnings: []
styles: btn(4886 ch[6ddd]) | primary(6ddd comb 4886)
nodes:  <div class="btn primary">, <div class="primary">   <-- second node
        resolves "primary" to the COMBO; no standalone stub emitted (MJ-1)

=== tailwindish  (zero CSS)
errors: []   warnings: []
styles: flex "" | items-center "" | gap-2 "" | text-sm ""

=== M2/B4 bad style block
errors: []
warnings: ["CSS parse error: Unclosed block"]
styles: [good, styleLess: ""]        <-- .good{color:red} SILENTLY LOST,
                                         payload offered for copy

=== svg class AS-051
errors: []
warnings: ["CSS class \"icon-path\" is defined but not used by any HTML element"]
                                     <-- false positive, still open

=== script in svg
errors: []
customCode: {"scripts":["alert(1)"]}
nodes: HtmlEmbed data.html = "<svg><script>alert(1)</script></svg>"
                                     <-- double emission, still open
```
