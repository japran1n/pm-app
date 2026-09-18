# M5 scrutiny — round 1

_Mission 20260917-170249 · reviewed 2026-09-18 · adversarial read-only review_

**Verdict: M5 is RED. 3 blockers, 4 majors.** Tests, lint and typecheck all
pass; that is not the problem. The problem is that two assertions are backed
by tests that assert the implementation rather than the contract, one
assertion has no test at all, and the help section ships factually wrong
breakpoint values to the user.

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-002 | PASS | Route file at `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` renders `ConverterPage`; editor + preview both assert-rendered. |
| AS-013 | PASS | Three `Tabs` triggers + three labelled textareas; switching verified by role query, not by internal state. |
| AS-014 | PASS (major) | Dot renders iff `values[tab].length > 0`; both present and absent cases tested. Colour is hardcoded `bg-blue-500` (see MAJ-4). |
| AS-015 | **FAIL — blocker** | Test never exercises any wiring. See BLK-2. |
| AS-016 | **FAIL — blocker** | Same defect as AS-015. See BLK-2. |
| AS-017 | PASS (major) | `srcDoc` contains combined HTML/CSS/JS and updates without reload. String interpolation is unescaped (see MAJ-1). |
| AS-018 | PASS | 300 ms debounce genuinely verified: not-before-299ms, fires-at-300ms, and timer-reset-on-rapid-change are three distinct fake-timer tests that would each fail if the debounce were removed. This is the strongest test in the milestone. |
| AS-019 | PASS | `sandbox="allow-scripts"` only. Tests assert `allow-same-origin`, `allow-forms` and `allow-top-navigation` are all absent, so widening the sandbox breaks the suite. |
| AS-020 | PARTIAL → **FAIL — major** | Confirm/cancel paths tested at the callback level only. The second half of the assertion — "and the live preview updates to blank" — has no test anywhere. See MAJ-2. |
| AS-021 | PASS (major) | Restore-on-mount, write-on-change, and both throw paths are tested. Mount-order race can transiently clobber storage (MAJ-3). |
| AS-022 | **FAIL — blocker** | No test. See BLK-3. |
| AS-124 | **FAIL — blocker** | Help section states breakpoint values that the engine does not implement. See BLK-1. |

Additional checks requested:

| ID | Result | Reason |
|----|--------|--------|
| AS-004 | PASS | `page.tsx` adds no auth logic and inherits the segment layout's `!user → redirect("/sign-in")` guard (layout.tsx:158). Correct by construction — the page cannot accidentally bypass a gate it never touches. |
| AS-023 | **NOT MET — out of milestone** | The task brief described AS-023 as "the page title/heading". It is not. AS-023 is *"A 'Convert' action is available as both a visible button and a keyboard shortcut."* No Convert button and no keyboard shortcut exist. This is correctly M6/F031 scope, so it is not an M5 blocker — but the brief's mislabel should not propagate into a sign-off. |
| M4 regressions | PASS | `lib/webflow-converter/` + `lib/actions/webflow-converter.ts` + sidebar/portal-isolation suites: 12 files, 430 tests, all green. No M5 change touched engine code. |

## Blockers

### BLK-1 — The help section documents breakpoints the converter does not support (AS-124)

`components/webflow-tool/converter-help.tsx` tells the user:

```
min-width: 1280px → Large
min-width: 1440px → XL
min-width: 1920px → XXL
```

`lib/webflow-converter/breakpoints.ts` implements:

```ts
minWidth: [
  { from: 2560, key: 'xxl' },
  { from: 1920, key: 'xl' },
  { from: 1440, key: 'large' },
]
```

Every one of the three min-width rows is wrong. `1280px` is not recognised at
all and silently produces no variant; `1440px` is Large not XL; `1920px` is XL
not XXL; `2560px` (XXL) is undocumented. AS-124 requires the help to explain
"the breakpoint pixel values it recognizes" — it currently explains values it
does not recognise. A user who follows this help will write a `min-width:
1280px` query, see it vanish from the output, and have no way to discover why.

This is compounded by the test being wrong in exactly the same direction:

```js
expect(screen.getByText(/1280px/)).toBeVisible()
```

`converter-help.test.tsx` asserts the incorrect strings are present, so the
suite will stay green forever while the help stays wrong, and will go *red* if
someone fixes the help. The test actively defends the bug.

Secondary inaccuracy in the same file: the help says `<img>` elements "become
plain Webflow blocks". `lib/webflow-converter/typemap.ts:117-123` maps `img` to
`type: "Image"`, and AS-095 requires a Webflow **Image** element. Also wrong.

### BLK-2 — AS-015/AS-016 tests do not test the wiring they claim to test

The two F028 tests in `converter-editor.test.tsx` render `ConverterEditor`,
fire a change, assert the `onHtmlChange` spy fired, and then — entirely
separately — call the pure engine directly:

```js
const result = convert(html, "")
expect(result.customCode.scripts).toHaveLength(1)
```

Those two halves are not connected. The component's value never reaches
`convert()`; the test passes `html` to `convert()` itself. The test would pass
identically if `ConverterEditor` were deleted and replaced with a stub, and it
would pass identically if no production code anywhere called `convert()`.

Which is in fact the case: **`ConverterPage` never calls `convert()`.** Grep
the M5 components — there is no conversion call site. AS-015 and AS-016 say
inline `<style>`/`<script>` in the HTML editor "are treated as additional
CSS/JS **without needing to be duplicated**" — that is a claim about the
editor-to-engine path, and that path does not exist yet. The engine-level
behaviour is genuinely covered in `lib/webflow-converter/convert.test.ts`, but
that coverage predates M5 and is what AS-089/AS-101 already buy. F028 added no
new verification.

Either these assertions belong to M6 (where the Convert wiring lands) and
should not be claimed here, or M5 must ship the wiring. Claiming them now on
the strength of these tests is not defensible.

### BLK-3 — AS-022 has no test, only a comment (AS-022)

AS-022: "The converter page has no viewport-size preset controls for the
preview pane." The only artifacts referencing it are two source comments and a
test-file header. `converter-page.test.tsx` contains three tests, all named
`test_AS_002_*`, none of which asserts the absence of viewport presets.

Negative assertions are the easiest to regress silently — a future feature
adding a "Desktop / Tablet / Mobile" toggle to the preview pane would break
AS-022 with a fully green suite. This needs an explicit assertion (e.g. no
control matching `/desktop|tablet|mobile|viewport|\d+px/i` renders in the
preview pane region).

## Majors

### MAJ-1 — Unescaped template interpolation in the preview `srcDoc` (AS-017)

`converter-preview.tsx`:

```js
<style>${css}</style>
...
<script>${js}</script>
```

Neither value is escaped. Any `</script>` substring in the JS tab — including
the entirely ordinary case of a user pasting a full HTML document into the JS
tab by mistake, or JS containing `document.write('</script>')` — terminates the
tag early, and the remainder leaks into the document as body HTML. Same for
`</style>` in the CSS tab. The result is a preview that silently renders
garbage with no error shown to the user.

Related: if the user pastes HTML containing `<script>` into the HTML tab *and*
fills the JS tab, both execute, so the preview double-runs scripts. This is the
preview-side mirror of the AS-015/AS-016 deduplication question and deserves a
deliberate decision rather than an accident.

The sandbox (AS-019) contains the blast radius, so this is a correctness and
UX defect, not a security one.

### MAJ-2 — AS-020's preview half is unverified

`test_AS_020_confirming_clears_all_three_editors` asserts three spies were
called with `""`. It does not assert that state actually cleared, and no test
asserts the preview's `srcDoc` goes blank after a clear. Because
`ConverterEditor` is fully controlled, a bug in `ConverterPage`'s state
plumbing would leave the preview showing stale content with the editors empty,
and every current test would still pass.

### MAJ-3 — Persistence mount-order race can clobber stored content (AS-021)

`useEditorPersistence` declares the restore effect before the write effect.
On mount both run in order against the *same* render's props: the restore
effect calls `setHtml(stored)` (scheduling a re-render), then the write effect
immediately runs with the still-empty `html` and executes
`localStorage.setItem(LS_KEY_HTML, "")` — wiping the stored value before the
restored state commits. It recovers on the following render, so the happy path
works and the tests pass. It does not recover if the component unmounts inside
that window (fast navigation away, or a Strict-Mode/Suspense re-entry), in
which case the user's saved work is gone.

A guard — skip the write effect until restore has completed — removes the
window entirely. The current tests use `renderHook` with spies and cannot
observe this ordering at all.

### MAJ-4 — Hardcoded palette values violate the repo's token rules (AS-121)

- `converter-editor.tsx`: the AS-014 dot indicator uses `bg-blue-500`, a raw
  Tailwind palette class. CLAUDE.md is explicit — "Colours are derived, not
  written"; semantic tokens only. This will not track the light/dark theme
  (AS-122) the way the rest of the page does.
- `converter-preview.tsx`: `bg-white` on the iframe. Defensible for a preview
  canvas rendering user content, but it should be a deliberate, commented
  choice rather than an inline literal.

## Minors

- **MIN-1 (AS-124):** the help is a `<details>` collapsed by default, and
  `test_AS_124_help_content_hidden_by_default` asserts
  `not.toBeVisible()`. AS-124 asks for a "short, **visible** help section". The
  summary affordance is visible, so this is arguable rather than clear-cut —
  but the test codifies the least generous reading of the assertion. Worth an
  explicit product call.
- **MIN-2:** `converter-page.test.tsx` names all three of its tests
  `test_AS_002_*`, including the one that actually exercises AS-017's
  propagation path. The AS-022 test that should be there is missing (BLK-3).
- **MIN-3:** `converter-page.test.tsx`'s propagation test uses a real
  `await new Promise(r => setTimeout(r, 350))` instead of fake timers,
  hardcoding a dependency on `DEBOUNCE_MS = 300`. Raising the debounce makes
  this flake rather than fail cleanly.

## Recommended follow-up features

**FU-A — Correct the converter help section's breakpoint and image copy.**
Rewrite the min-width rows in `converter-help.tsx` to match
`lib/webflow-converter/breakpoints.ts` exactly: 1440px → Large, 1920px → XL,
2560px → XXL, and drop 1280px entirely (or state explicitly that it is not
recognised). Correct the images paragraph to say `<img>` becomes a Webflow
**Image** element with no `src`, matching AS-095 and typemap.ts. Then rewrite
`converter-help.test.tsx` so it derives its expectations from the exported
`BREAKPOINTS` constant rather than hardcoding pixel strings — the test must
fail if the engine's breakpoint table and the help text ever diverge again.
That import-and-compare structure is the actual fix; changing the numbers
alone leaves the same class of bug free to recur.

**FU-B — Wire the editor to the conversion engine, or reassign AS-015/AS-016
to M6.** Decide which milestone owns the editor→`convert()` path. If M5 keeps
these assertions, `ConverterPage` must actually call `convert(html, css)` and
the tests must drive the assertion through the rendered component — type into
the HTML textarea, then assert on what the page does with the result — so that
breaking the wiring fails the test. If the path belongs to M6/F031, strike
AS-015 and AS-016 from M5's claimed coverage and let F031's tests earn them.
Do not leave them marked covered by tests that call the engine directly.

**FU-C — Give AS-022 and AS-020's preview half real assertions.** Add a test
to `converter-page.test.tsx` asserting no viewport-preset control renders in
the preview region (query by role for buttons matching
`/desktop|tablet|mobile|viewport|^\d+\s*px$/i` and assert an empty result), so
that adding presets later fails loudly. Separately, add an integration test
that types HTML, confirms Clear all through the dialog, advances past the
debounce, and asserts the iframe's `srcDoc` no longer contains the typed
content — closing the untested half of AS-020.

**FU-D — Harden the preview document assembly.** Escape or neutralise
`</script>` and `</style>` sequences when interpolating the CSS and JS tabs
into `buildSrcDoc` (splitting on the closing-tag sequence is the standard
approach), and decide deliberately whether HTML-tab `<script>` content should
be stripped from the preview body to avoid double execution alongside the JS
tab. Cover both with tests that feed a `</script>`-containing string through
and assert the document structure survives.

**FU-E — Remove the persistence mount race and the hardcoded palette values.**
Gate `useEditorPersistence`'s write effect behind a "restore has run" ref so
it cannot write empty strings over stored content during the mount window, and
add a test that mounts with stored content, unmounts immediately, and asserts
localStorage still holds the original values. In the same pass, replace
`bg-blue-500` on the tab dot with a semantic token per CLAUDE.md's colour
rules, and either tokenise or explicitly justify `bg-white` on the preview
iframe.

---

## Gate output

### `npx vitest run components/webflow-tool/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  5 passed (5)
      Tests  31 passed (31)
   Start at  01:05:40
   Duration  1.50s (transform 375ms, setup 1.51s, import 369ms,
                   tests 808ms, environment 1.64s)
```

### Regression run — `npx vitest run lib/webflow-converter/ lib/actions/webflow-converter.test.ts tests/unit/app-sidebar-webflow-nav.test.tsx tests/unit/f004-webflow-tool-portal-isolation.test.ts`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  12 passed (12)
      Tests  430 passed (430)
   Start at  01:07:08
   Duration  3.19s (transform 362ms, setup 698ms, import 594ms,
                   tests 2.32s, environment 321ms)
```

No M4 regressions.

### `npx tsc --noEmit`

```
(no output — clean)
```

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no violations)
```

### Non-blocking environment warnings observed in all vitest runs

```
(!) Your Vite config uses features that are unsupported by
    `configLoader: 'native'`:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)
  - ESM syntax in a file loaded as CommonJS
    (tests/realtime-live-delivery-tests.ts:18:1)

ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided.
```

The second warning is why `use-editor-persistence.test.ts` carries its own
in-file `localStorage` polyfill. Pre-existing repo-level condition, not
introduced by M5.
