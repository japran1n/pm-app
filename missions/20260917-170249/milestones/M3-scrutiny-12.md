# M3 Scrutiny — Round 12

# VERDICT: M3 is GREEN — no blockers.

The round-11 blocker (B4 / AS-089) is **fixed and empirically verified**.
F096 does what it claims. No round-11 major has risen to blocker status.
Seven majors remain open and are recommended as follow-up work, but none
prevents M3 from closing.

Gates: `lib/webflow-converter` **395/395 pass** (up from 393; F096 added 2);
`npx tsc --noEmit` exit 0; `npm run lint` exit 0 with zero output.

## The key question: is AS-089 now PASS? — YES

Probed through `convert()`, not through unit seams. Every case below is a
non-null, error-free payload in which the *good* sources keep their real
declarations:

| Input | Result |
|---|---|
| `<div class="good">x</div><style>.bad{color:</style>` + `.good{color:red}` | `good[color: red;]`, warning `CSS parse error in <style> block 1 : Unclosed block` |
| bad `css` arg + good `<style>` | `good[color: red;]`, warning names `css input` |
| two `<style>` blocks, 2nd bad | `a[color: red;]` survives, `b[]` stub |
| three blocks, 2nd bad | `a[color: red;]` and `c[color: blue;]` both survive |

Before F096 the string-join at `convert.ts:49` meant `.good` was lost in all
four. The fail-open posture that caused round 11 to escalate is gone: the
blast radius of a syntax error is now exactly the one source that contains
it, and the warning names that source.

The two new tests (`convert.test.ts:20`, `:33`) are behaviour tests, not
mirrors — reverting to the string-join makes both fail, confirmed by
`parseCss(".bad{color:\n.good{color:red}")` returning `order: []`.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-051 | **FAIL — major** | Unchanged. `<svg><path class="icon-path"/></svg>` + `.icon-path{fill:red}` still warns "defined but not used". `walkElement` (`emit.ts:317`) returns the svg as `HtmlEmbed` without descending, so no node carries the class. Assertion holds literally (unused ⇒ warns); the converse fails. Zero tests mention `svg`. |
| AS-089 | **PASS** | Fixed by F096. Script/style produce no nodes (verified: `<div class="a"><style>…</style><script>…</script><p>hi</p></div>` emits one Block whose only child is the Paragraph); CSS reaches the style model; a bad source no longer poisons the others. |
| AS-114 | PASS (2 majors) | Every node class resolves by construction. Two substance holes below (MJ-1 shadowing, MJ-5 duplicate `b`). |
| AS-116 | PASS — major hole | `emit.ts` cannot collide (`crypto.randomUUID`, shared fallback counter). But `validator.ts` keeps node ids (`seenIds`) and style ids (`styleMap`) in separate namespaces and never cross-checks — a style `_id` equal to a node `_id` validates clean. Unreachable today ⇒ major, not blocker. |
| AS-117 | PASS | Validator enforces both halves (`validator.ts:144-153`); no dangling `comb` in any probe. Cost is MJ-2's declaration loss. |
| AS-118 | INCONCLUSIVE | Engine-level correct: `.0bad{color:red}` ⇒ `errors: [...]`, `payload: null`, nothing copyable. But `grep -rn "webflow-converter" app components lib hooks` finds no consumer outside the module — the route is still a placeholder. Unverifiable until M6. |
| AS-119 | PASS | `validator.ts:194` computes `valid: errors.length === 0` unconditionally, no escape hatch. Tests remain near-tautological (noted since round 10) but the property is solid. |
| AS-120 | PASS | CSS warnings reach the result via `emit.ts:346` seeding from `cssMap.warnings`. Verified for the new per-source parse errors. |
| AS-135/136/137/138 | PASS | 395 converter tests under the repo's vitest config; lint and `tsc --noEmit` both exit 0. |
| AS-141 | PASS | No throw on `(null,null)`, `(undefined,undefined)`, `("<div","{{{")`, unclosed `@media` in both sources, `<script src=' '>`, 50 unclosed nested divs. All return structured results. |

Assertions passed in earlier rounds and untouched by F096 (AS-011, AS-041,
AS-052, AS-069, AS-091, AS-101, AS-103, AS-110, AS-111, AS-112) carry
forward; re-probing found no regression.

## Status of round-11 majors (none escalated)

- **MJ-1 — AS-114 name shadowing.** Still open. `.btn{} .btn.primary{}` with
  `<div class="btn primary">` and `<div class="primary">`: the bare node's
  `primary` binds to the combo style and silently inherits `.btn.primary`'s
  declarations. `convert.test.ts:73` currently enshrines this. Fidelity bug,
  not a validation bug. **Major.**
- **MJ-2 — combo synthesis capped at one level** (`emit.ts:189-191`). Still
  open. `.a{color:red} .a.b.c.d{color:green}` → `color: green` is present
  nowhere in the payload; the AS-114 stub pass papers the gap with an empty
  `d`. A visible warning fires, so **major**, not blocker. No test covers a
  three-level chain.
- **MJ-3 — `walkNodes` silent skips** (`validator.ts:56`, `:83`). Still open
  and confirmed: `children: "haha"`, `children: {a:1}`, `classes: "nope"`,
  `classes: null` all yield `{valid: true, errors: []}`. `classes` as a
  non-array skips the AS-114 check entirely. Unreachable from `emit.ts`
  today ⇒ **major**, but the validator's own header calls itself the last
  line of defence before the clipboard.
- **MJ-4 — `<script>` nested in `<svg>` double-emitted.** Still open:
  `customCode.scripts: ["alert(1)"]` *and* `data.html` containing the script
  verbatim. Executes twice on paste. **Major.**

## New majors found this round

- **MJ-5 — reachable duplicate style names from chain registration.**
  `.a{} .a.b.c{}` emits **two styles named `b`**: a standalone registered by
  `css.ts:176` for the non-terminal chain member, and the synthesized combo
  stub. The node's `classes: ["a","b","c"]` reference is ambiguous. Round 9
  explicitly ruled duplicate style *names* legitimate, so this is **not** a
  blocker and must **not** be fixed by adding a uniqueness error — but the
  ambiguity is real and the AS-117 test at `convert.test.ts:49` passes while
  it is live, because it asserts only that every `comb` resolves, never that
  `color: blue` survives.
- **MJ-6 — AS-116 namespace split in the validator** (see table).

## Minors

- Warning text never says declarations were *dropped* — the consequential
  part. Actual: `CSS parse error in <style> block 1 : Unclosed block`.
- Stray space before the colon in that warning (`convert.ts:64` builds
  `+ " : "`).
- Blank `<style>` blocks are discarded by `extractStyles` (`js-extract.ts:78`)
  before indexing, so the block number can point at the wrong element:
  `<style>   </style><style>.bad{color:</style>` reports "block 1" for the
  user's second `<style>`. Comment-only blocks are *not* dropped, so the
  numbering is inconsistent rather than uniformly off by one.
- Nothing asserts the new source label text; deleting the whole relabeling
  block (`convert.ts:57-69`) leaves every test green.
- `mergeCssResults` has zero direct unit tests.
- The `order.length === 0 && src.trim() !== ""` guard at `convert.ts:60` is
  dead weight — the `startsWith("CSS parse error:")` check already gates it —
  and would silently suppress labels if `parseCss` ever gained partial
  recovery.
- `r.classes.get(key)!` (`css.ts:247`) would write `undefined` into the
  merged map for a hand-built result with a stale `order`.
- AS-051's warning still leaks the pipe-joined combo key (`"x|b"`) into
  user-facing text; should read `.x.b`.
- Carried from round 10: the AS-011 guard test only scans files whose
  filename contains "webflow" (the real route is `page.tsx`);
  `!RESERVED_ATTRS.has(name)` (`emit.ts:263`) is a dead branch; `id=""` is
  dropped by the truthiness check at `emit.ts:301`.

## Recommended follow-up features

**FU-E — stub standalone classes shadowed by a combo of the same name
(AS-114, major).** In the stub pass at `emit.ts:362-383`, build the
"already covered" name set from styles with `comb === ""` only, so a class
whose only definition is a combo still receives its own standalone stub.
Test: `.btn{} .btn.primary{}` with `<div class="btn primary">` and
`<div class="primary">` must produce a standalone `primary` with `comb: ""`
in addition to the combo; both nodes validate; the combo stays in `btn`'s
`children`. `convert.test.ts:73` currently asserts the opposite and must be
updated as part of this feature. Add no error and no uniqueness check — fix
purely by emitting an extra style.

**FU-F — recursive combo-chain synthesis (AS-117/MJ-2, major).** Replace the
one-level synthesis at `emit.ts:189-208` with a loop walking the `comboOf`
prefix chain from the shallowest missing ancestor down, creating and chaining
a stub per missing intermediate, so a combo's declarations are never dropped
at any depth. The warn-and-skip path becomes unreachable; its test should be
replaced by one asserting `.a{color:red} .a.b.c.d{color:green}` yields a full
`a → b → c → d` chain with `color: green;` on `d`. Also add a
declaration-survival assertion to `convert.test.ts:49` (`color: blue` must be
present), which today asserts only that `comb` ids resolve.

**FU-G — collect classes from skipped subtrees for the AS-051 usage check
(AS-051, major).** Before returning early for an `svg → HtmlEmbed`
(`emit.ts:317`) — and for any other `SKIPPED_TAGS` subtree — scan the
embedded markup for `class` attributes and record those names in a
"seen in HTML" set used solely by the defined-but-unused check, creating no
nodes and no stubs. Tests: `.icon-path{fill:red}` with
`<svg><path class="icon-path"/></svg>` must produce no warning, while a class
genuinely absent from the whole document still warns. Also fix the pipe-key
leak so combo keys render as `.x.b`.

**FU-H — harden `walkNodes` against malformed shapes (MJ-3, major).**
`validator.ts:56` and `:83` must push an error rather than `return`/skip when
`children` is a truthy non-array or `classes` is not an array. Add a
cross-namespace `_id` uniqueness check so a style `_id` colliding with a node
`_id` is an error (AS-116/MJ-6). Tests must feed hand-built malformed
payloads — `children: "haha"`, `children: {a:1}`, `classes: "nope"`,
`classes: null`, and a style/node id collision — and assert `valid === false`
in each case.

**FU-I — do not extract `<script>` from inside an embedded subtree (MJ-4,
major).** `js-extract.ts` should skip `<script>` elements having an ancestor
that `emit.ts` renders as an `HtmlEmbed` (currently `svg`), since that markup
already travels verbatim in `data.html`. Test:
`<svg><script>alert(1)</script></svg>` must yield exactly one copy — in
`data.html` — and an empty `customCode.scripts`.

**FU-J — sharpen the CSS parse-error warning (AS-089/AS-120, minor).**
Extend the F096 warning to state the consequence ("… — all rules in this
block were dropped") and, when postcss reports one, the line/column. Preserve
original `<style>` element indices in `extractStyles` (return
`{index, text}`) so blank blocks no longer shift the reported block number.
Remove the stray space before the colon. Add a test asserting the exact
label text so the relabeling is mutation-protected, plus direct unit tests
for `mergeCssResults` covering order stability, per-variant merge precedence
and warning concatenation.

---

## Gate output

### `npx vitest run lib/webflow-converter`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  9 passed (9)
      Tests  395 passed (395)
   Duration  481ms (transform 312ms, setup 401ms, import 341ms, tests 93ms)
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

(Full-repo `npm test` still carries the pre-existing `tests/integration/**`
`fetch failed` Supabase network failures, unrelated to M3.)

### Adversarial probe output — AS-089 (via `convert()`)

```
=== B4 bad style block, good css arg
errors: []
warnings: ["CSS parse error in <style> block 1 : Unclosed block"]
styles: good[color: red;]                    <-- FIXED (was good[""])

=== bad css arg, good style block
errors: []
warnings: ["CSS parse error in css input : Unclosed block"]
styles: good[color: red;]

=== two style blocks, second bad
errors: []
warnings: ["CSS parse error in <style> block 2 : Unclosed block"]
styles: a[color: red;] | b[]

=== three blocks, 2nd bad -> label check
errors: []
warnings: ["CSS parse error in <style> block 2 : Unclosed block"]
styles: a[color: red;] | c[color: blue;]

=== good rules BEFORE error in same source
errors: []
warnings: ["CSS parse error in css input : Unclosed block"]
styles: a[] | b[]              <-- whole source lost; inherent to postcss,
                                   warning present, acceptable degradation

=== legacy comment-wrapped <style><!-- ... --></style>
errors: []
warnings: ["CSS parse error in <style> block 1 : Unknown word -->"]
styles: good[]                 <-- still unparseable; warned, not silent

=== later source wins
css arg .good{color:red} + <style>.good{color:blue}</style>
styles: good[color: blue;]
```

### Adversarial probe output — open majors (via `convert()`)

```
=== MJ-G  svg class AS-051 false positive
warnings: ["CSS class \"icon-path\" is defined but not used by any HTML element"]
styles: icon-path[fill: red;]                <-- class IS used, in the svg

=== MJ-1  standalone name shadowed by combo  (.btn{} .btn.primary{})
errors: []   warnings: []
styles: btn(5966)[color: red;] | primary(12ab)[color: blue;] comb=5966
nodes:  <div class="btn primary">, <div class="primary">
        second node binds "primary" to the COMBO; no standalone stub

=== MJ-2  two missing intermediates  (.a{color:red} .a.b.c.d{color:green})
errors: []
warnings: ["combo class \"d\" references base \"a.b.c\" which has no style
           definition — cannot emit combo"]
styles: a[color: red;] | b[] | c[] | d[]     <-- color: green LOST entirely

=== MJ-5  duplicate style name  (.a{} .a.b.c{})
styles: a | b(stub, comb:"") | b(comb=a) | c(comb=b)
        two styles named "b"; node classes ["a","b","c"] bind ambiguously

=== MJ-4  script in svg
customCode: {"scripts":["alert(1)"]}
nodes: HtmlEmbed data.html = "<svg><script>alert(1)</script></svg>"
        double emission -> executes twice on paste

=== MJ-3  validator vs malformed shapes
{children: "haha"}   -> {valid:true, errors:[]}
{children: {a:1}}    -> {valid:true, errors:[]}
{classes: "nope"}    -> {valid:true, errors:[]}   (AS-114 check skipped)
{classes: null}      -> {valid:true, errors:[]}

=== MJ-6  style _id == node _id
-> {valid:true, errors:[]}                   (separate namespaces)

=== AS-118 engine level
.0bad{color:red} -> errors: ["Style class name \"0bad\" is not a valid
                    Webflow class name"], payload: NULL
```
