# M5 scrutiny — round 2

_Mission 20260917-170249 · reviewed 2026-09-18 · HEAD `f6c83049` · adversarial read-only review_

**Verdict: M5 is RED. 1 blocker remains (was 3), 5 majors (was 4).**

Round-1 blockers B1 and B3 are addressed; B3 only partially. B2 is not fixed —
the dishonest test was deleted and replaced with an honest test of a *different*
thing, which removes the false evidence but leaves AS-015/AS-016 with no
verification at all in M5. Gate commands (vitest / tsc / eslint) are all green;
that is not the question.

## Blocker fix verification

| # | Round-1 blocker | Status |
|---|---|---|
| B1 | AS-124 help breakpoints wrong | **FIXED.** `converter-help.tsx:43-50` now reads 1440→Large, 1920→XL, 2560→XXL, matching `lib/webflow-converter/breakpoints.ts:19-22`. `1280px` removed. `mapBreakpoint` is strict-equality (`breakpoints.ts:87,91`), so the closing line "Other breakpoint values are not converted" is accurate. The `<img>` copy now correctly says Webflow **Image** block, matching `typemap.ts:123`. Residual test weakness → MAJ-5. |
| B2 | AS-015/016 fake tests | **NOT FIXED — still blocker.** See BLK-1. |
| B3 | AS-022 had no test | **PARTIALLY FIXED — downgraded to major.** A test now exists; it cannot catch the regression it was written to catch. See MAJ-6. |

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-002 | PASS | `page.tsx` renders `ConverterPage`; editor + preview both assert-rendered. Unchanged from round 1. |
| AS-013 | PASS | Three tab triggers + three labelled textareas, switching verified by role query. |
| AS-014 | PASS (major) | Dot renders iff `values[tab].length > 0`; both cases tested. Still `bg-blue-500` (MAJ-4). |
| AS-015 | **FAIL — blocker** | No component calls `convert()`. Test asserts only that a controlled textarea fires `onChange`. See BLK-1. |
| AS-016 | **FAIL — blocker** | Same, plus the JS-tab→`<script>` append step `convert.ts:38-43` says M5 owns does not exist. See BLK-1. |
| AS-017 | PASS (major) | `converter-page.test.tsx:29-44` drives the real editor→page→preview path. `srcDoc` interpolation still unescaped (MAJ-1). |
| AS-018 | PASS | Three distinct fake-timer tests (not-before-299ms, fires-at-300ms, reset-on-rapid-change). Strongest coverage in the milestone. |
| AS-019 | PASS | `sandbox="allow-scripts"` only; tests assert `allow-same-origin`/`allow-forms`/`allow-top-navigation` absent, so widening the sandbox goes red. |
| AS-020 | **FAIL — major** | Confirm/cancel tested at callback level with `vi.fn()` mocks. The assertion's second half — "the live preview updates to blank" — is tested nowhere. See MAJ-2. |
| AS-021 | PASS (major) | Restore/write/throw paths tested. Mount-order race unfixed (MAJ-3). |
| AS-022 | PASS (major) | Code is correct today — no viewport controls exist. The new test does not protect it. See MAJ-6. |
| AS-124 | PASS (major) | Help renders, is short, covers class-selector contract and the correct breakpoint values. Test does not derive from the engine constants and does not check value→label mapping (MAJ-5); range-syntax forms undocumented (MAJ-7). |

Regression checks: `lib/webflow-converter/` + `lib/actions/webflow-converter.test.ts`
+ sidebar/portal-isolation — 12 files, 430 tests green. No M4 regression.

## Blocker

### BLK-1 — AS-015/AS-016 have no verification in M5 (blocker)

The fix deleted the `convert()` calls from `converter-editor.test.tsx` and
renamed the tests to `test_AS_015_inline_style_in_html_not_stripped` /
`test_AS_016_inline_script_in_html_not_stripped`. What each test now does, in
full: render a controlled `<textarea>`, `fireEvent.change` it, assert the
`onHtmlChange` spy received the same string.

That is a test of React's controlled-input contract, not of either assertion.
It stays green if `convert()` is deleted, if `extractStyles()` returns `[]`, or
if `cssSources` (`convert.ts:53`) stops concatenating `stylesResult.styles`.

The underlying gap is unchanged and is structural:

- **No component in `components/webflow-tool/` imports `lib/webflow-converter/`.**
  `converter-page.tsx:52` still holds the placeholder
  `{/* F031-F036: Convert button, copy buttons, and results panel go here */}`.
  There is no editor→engine path to verify.
- **The JS tab feeds nothing into conversion.** `convert(html, css)` takes no
  `js` parameter, and its own docstring (`convert.ts:38-43`) states the design
  assumes *"the UI layer (M5) appends the JS-tab content to `html` as one or
  more `<script>` blocks before calling convert()"*. That appending code does
  not exist anywhere. `converter-page.tsx:23` holds `js` in state and passes it
  only to the editor and the preview. AS-016's premise — "without needing to be
  duplicated in the JS tab" — is not merely untested, it is unimplemented.

F028's own spec is explicit that its deliverable is *"the UI-level test
confirming the wiring is correct end to end."* The wiring lands in F031, which
is M6. F028 as written cannot be satisfied inside M5; this is a dependency
inversion in the plan, not worker error. But the resolution is a scoping
decision the orchestrator must record, not a comment in a test file. Right now
M5 claims AS-015 and AS-016 on the strength of two textarea passthrough tests,
and that is not defensible.

The honest fix made the evidence truthful. It did not make the assertion met.

## Majors

### MAJ-6 — the AS-022 test cannot catch the regression it exists to catch (new, replaces BLK-3)

`converter-page.test.tsx:46-59` queries only `role="button"` and `role="tab"`,
filtered by `/desktop|tablet|mobile|991|767|479/i`. It passes vacuously over a
tree that never contained such controls, and keeps passing through most
plausible regressions:

- **Wrong roles.** A ToggleGroup or RadioGroup preset switcher exposes
  `role="radio"`; a `<select>` exposes `combobox`; a width slider exposes
  `slider`; a dropdown item exposes `menuitemradio`. None are queried.
- **Wrong vocabulary.** The numeric alternatives are Webflow *authoring*
  breakpoints. Preview presets are conventionally labelled `1440 / 1024 / 768 /
  375`, or `sm/md/lg`, or Wide/Narrow/Fit. A three-button `375 | 768 | 1440`
  toolbar — precisely the reference-prototype control AS-022 forbids — passes.
- **Icon-only controls.** Lucide `Monitor`/`Tablet`/`Smartphone` buttons with no
  `aria-label` have an empty accessible name and are excluded by the `name`
  filter. The worse the accessibility of the regression, the more reliably the
  test passes.
- **Nothing scopes the query to the preview pane**, and the self-exempting
  comment at lines 49-52 documents that the numeric half of the regex exists to
  avoid a false positive from `ConverterHelp`, not to catch anything.

Constrain the shape, not a word list: assert `ConverterPreview` takes no width
or viewport prop, and that the preview pane contains no interactive descendant
other than the iframe.

Downgraded from blocker because the code genuinely satisfies AS-022 today.

### MAJ-5 — the help test still cannot detect divergence from the engine (AS-124)

`converter-help.test.tsx:42-47` hardcodes six pixel-string regexes and imports
neither `BREAKPOINTS` nor `mapBreakpoint`. Change `upTo: 991` to `upTo: 1024` in
`breakpoints.ts` and the help silently becomes wrong with a green suite — the
exact failure mode of BLK-1 in round 1, still live. Worse, the test asserts only
*presence* of each pixel string, never the value→label mapping: swapping the
"1440px → Large" and "1920px → XL" rows leaves the suite green. Round 1 named
import-and-compare as the actual fix; the numbers were changed instead.

### MAJ-7 — the help omits recognised breakpoint syntaxes (AS-124)

`mapBreakpoint` also accepts `(width <= 991px)` → medium (`breakpoints.ts:102`),
`(width < 480px)` → tiny via the `px - 1` conversion (line 105), and
`(width >= 1440px)` → large (line 108), and strips `screen and ` / `only screen and `
prefixes (lines 53-65). The help lists only `min-width`/`max-width` forms and
then states "Other breakpoint values are not converted" — so a user with
`(width < 480px)` in their CSS will wrongly believe it is dropped. AS-124 asks
the help to explain "the breakpoint pixel values it recognizes"; it explains a
subset while implying completeness.

### MAJ-1 — unescaped `</script>` / `</style>` in the preview `srcDoc` (unchanged)

`converter-preview.tsx:20,24` still interpolate `css` and `js` raw. Any
`</script>` substring in the JS tab terminates the tag early and leaks the
remainder into the body. Sandbox contains the blast radius, so this is a
correctness/UX defect, not a security one. Unaddressed since round 1.

### MAJ-2 — AS-020's preview half is unverified (unchanged, confirmed)

`converter-editor.test.tsx:118-136` renders with `vi.fn()` mocks, so no state
ever changes and no preview exists in that tree. `converter-page.test.tsx` has
no Clear-all test at all. Regressions that would pass today: `converter-page.tsx:42-44`
wiring `onCssChange` correctly but dropping `onJsChange`; a future
`if (!html) return` in the debounce effect leaving stale `srcDoc` on screen;
`useEditorPersistence`'s rehydrate effect re-populating after a clear.

### MAJ-3 — persistence mount-order race (unchanged)

`converter-editor.tsx:33-56`: the restore effect still precedes the write
effect with no "restore has run" guard, so on mount the write effect executes
`setItem(LS_KEY_HTML, "")` against the pre-restore render's props. Recovers on
the next render; does not recover if the component unmounts inside that window.

### MAJ-4 — hardcoded palette values (unchanged)

`converter-editor.tsx:134` still `bg-blue-500`; `converter-preview.tsx:47` still
`bg-white`. CLAUDE.md: "Colours are derived, not written."

## Minors

- **MIN-1:** `test_AS_124_help_content_hidden_by_default` asserts the contract
  text is *not* visible, while AS-124 asks for a "short, **visible** help
  section." The summary affordance is visible; arguable, but the test codifies
  the least generous reading. Product call, unchanged from round 1.
- **MIN-2:** `converter-page.test.tsx` still names its AS-017 propagation test
  `test_AS_002_*`.
- **MIN-3:** that same test uses a real `setTimeout(350)` rather than fake
  timers, hardcoding a dependency on `DEBOUNCE_MS = 300`.
- **MIN-4:** the help's friendly names ("Tablet (medium)", "Mobile Portrait
  (tiny)") are the help's own gloss; the engine keys are bare `medium`/`small`/
  `tiny`. Harmless, but not sourced from the engine.

## Recommended follow-up features

**FU-F — Resolve AS-015/AS-016 ownership, and implement the JS-tab append.**
The orchestrator must make an explicit, recorded scoping decision: either M5
ships the editor→engine wiring, or AS-015 and AS-016 are struck from M5's
claimed coverage and earned by F031 in M6. The contract itself is immutable and
must not be edited; the milestone ledger records the reassignment. Whichever
milestone takes them, the work is the same: `ConverterPage` must assemble the
JS-tab content into `<script>` blocks appended to the HTML before calling
`convert(html, css)` — `convert.ts:38-43` explicitly names this as the UI
layer's job and nothing performs it today — and the tests must drive the
assertion through the rendered component (type into the HTML tab, leave the
CSS/JS tabs empty, assert the resulting payload contains the inline styles and
the script), so that breaking the wiring fails the test.

**FU-G — Make the AS-022 negative assertion shape-based rather than word-based.**
Replace the role+name regex in `converter-page.test.tsx` with a structural
check that a preset control cannot slip past regardless of how it is labelled or
which primitive it is built from: assert `ConverterPreview`'s props contain no
width/viewport/device key, and assert the preview pane subtree contains no
interactive element (`button`, `a`, `select`, `input`, `[role]` in the widget
roles) other than the iframe itself. Add a deliberately-failing sanity check
during development — temporarily render an icon-only `Monitor` button and
confirm the test goes red — so the assertion is proven falsifiable rather than
assumed to be.

**FU-H — Derive the help section's expectations from the engine constants.**
Rewrite `converter-help.test.tsx` to import `BREAKPOINTS` and `mapBreakpoint`
and assert, for every pixel value the help renders, that `mapBreakpoint` returns
the breakpoint key the help claims — so the test fails on a value change *and*
on a value/label swap. In the same pass, extend the help copy to cover the range
syntaxes the engine accepts (`(width <= Npx)`, `(width < Npx)`, `(width >= Npx)`,
and the `screen and` prefix) and to note that `(width > Npx)` is deliberately
unmapped, so "other breakpoint values are not converted" stops being misleading.

**FU-I — Give AS-020's preview half a real test.** Add an integration test to
`converter-page.test.tsx` that renders `ConverterPage`, types into all three
tabs, opens Clear all, confirms through the dialog, advances past the debounce
with fake timers, and asserts both that every textarea is empty and that the
iframe's `srcDoc` contains none of the typed content. This is the only place
clearing and the preview coexist, so it is the only place the assertion's second
half can be observed.

**FU-J — Carry forward round-1 FU-D and FU-E unchanged.** Escape `</script>` and
`</style>` sequences in `buildSrcDoc` and decide deliberately whether HTML-tab
script content should be stripped from the preview to avoid double execution;
gate `useEditorPersistence`'s write effect behind a "restore has run" ref and
test the mount-then-immediately-unmount case; replace `bg-blue-500` with a
semantic token and tokenise or explicitly justify `bg-white`. None of these were
touched by `f6c83049` and all three remain exactly as described in round 1.

---

## Gate output

### `npx vitest run components/webflow-tool/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  5 passed (5)
      Tests  32 passed (32)
   Start at  01:11:23
   Duration  1.49s (transform 327ms, setup 1.51s, import 312ms,
                   tests 858ms, environment 1.65s)
```

Green. 32 tests, up one from round 1's 31 — the added
`test_AS_022_no_viewport_preset_controls`.

### Regression — `npx vitest run lib/webflow-converter/ lib/actions/webflow-converter.test.ts tests/unit/app-sidebar-webflow-nav.test.tsx tests/unit/f004-webflow-tool-portal-isolation.test.ts`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  12 passed (12)
      Tests  430 passed (430)
   Start at  01:12:08
   Duration  3.19s (transform 373ms, setup 693ms, import 602ms,
                   tests 2.32s, environment 320ms)
```

No M4 regressions.

### `npx tsc --noEmit`

```
(no output — exit 0)
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no violations)
```

### Non-blocking environment warnings (all vitest runs)

```
(!) Your Vite config uses features that are unsupported by
    `configLoader: 'native'`:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)
  - ESM syntax in a file loaded as CommonJS
    (tests/realtime-live-delivery-tests.ts:18:1)

ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided.
```

Pre-existing repo-level condition, not introduced by M5.
