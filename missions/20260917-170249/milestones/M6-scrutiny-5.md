# M6 scrutiny report (round 5 — re-scrutiny after F097–F098)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Round-1 `M6-scrutiny-1.md` (RED) · Round-2 (AMBER) · Round-3 (AMBER, 5 majors) · Round-4 `M6-scrutiny-4.md` (AMBER, 4 majors)

Verdict: **AMBER — 0 blockers, 1 major. NOT GREEN.**

**All four round-4 majors (D-N1, D-N2, D-N3, D-N4) are genuinely closed and
mutation-confirmed.** F097 and F098 did what they claimed; this is the first round where
no carried-forward major survives.

The single remaining major is **not a regression and not new code** — it is a
pre-existing false-green in `test_AS_119_copy_button_disabled_when_ok_but_has_errors`
that rounds 1–4 all missed. The AS-119 errors guard can be **deleted outright** and the
suite stays 94/94 green. The implementation is correct; the assertion is simply unpinned.
Per the standing standard ("a test that only confirms the implementation rather than the
assertion's intent means the assertion FAILS even when it passes today"), AS-119 is FAIL /
major — severity *major*, not blocker, because the behaviour is met today and only the
guard against regression is missing.

Blast radius since round 4 is exactly 4 files (2 source +25/-3 lines, 2 test +82/-10):
`clipboard.ts`, `converter-page.tsx`, `clipboard.test.ts`, `converter-page.test.tsx`.
Every assertion whose code lies outside those files carries its round-4 verdict forward.

Suite: 9 files / **94 tests passed** (was 93). `npx tsc --noEmit` clean. `npm run lint`
clean. This round the green suite *is* partly evidence — six of eight mutations now fail
the suite — but see MUT P.

## Round-4 majors — re-verified

| Round-4 defect | Status | Evidence |
|---|---|---|
| **D-N3** happy path never asserts `true` | **CLOSED** | `clipboard.test.ts:41-56` — both the AS-031 json path and the text/plain path now assert `expect(result).toBe(true)`. MUT J (`return false;` at `clipboard.ts:54`) → **2 failed / 92 passed**. Round 4 had this at 93/93 green. |
| **D-N1** async-API guard one method wide | **CLOSED** | `test_no_async_clipboard_api_used` now spies `write`, `writeText`, `read`, `readText` **and the `navigator.clipboard` getter itself**, so any *access* to the async surface fails — strictly stronger than the fix that was requested. MUT K (insert `navigator.clipboard?.writeText?.("x")` before `execCommand`) → **1 failed / 93 passed**. Round 4: all green. |
| **D-N2** copy enabled against a stale result while loading | **CLOSED** | `converter-page.tsx:159` is now `disabled={loading \|\| !result?.ok \|\| (result?.errors?.length ?? 0) > 0}`. `test_copy_disabled_during_convert` uses a genuinely **deferred** promise (`mockConvert.mockReturnValueOnce(new Promise(...))`), asserts the button is disabled mid-flight while `result` still holds the prior payload, then resolves and asserts re-enable. MUT L (drop `loading \|\|`) → **1 failed / 93 passed**. The round-4 probe path (`copiedShownWhileConverting = true`) is no longer reachable. |
| **D-N4** failure inaudible and unnamed | **CLOSED** | The static `aria-label="Copy for Webflow"` is gone (`:160-162`), so the button's accessible name now follows its visible text; a dedicated `role="alert"` sr-only region (`:192-194`) announces "Copy failed — try again"; and `handleCopyWebflow` (`:93-95`) no longer auto-clears the error state. Two tests query by `findByRole("alert")` + `toHaveTextContent`, i.e. the announcement rather than pixels. MUT M (strip `role="alert"`) → **2 failed / 92 passed**. |

D-n5 (read-back fidelity) is **closed in code** — `clipboard.ts:32` is now
`written !== item.data`, not `!written` — though not independently pinned (MUT I below).

## Assertion verdicts

Standard applied: a test that only confirms the implementation rather than the
assertion's intent means the assertion FAILS even when it passes today.

| ID | Verdict | Sev | Reason |
|---|---|---|---|
| AS-011 | PASS | — | Unchanged since round 3. No `.from()`/RPC/storage in `webflow-converter.ts`; only `auth.getUser()`. Unenforced by tooling (D-m8). |
| AS-023 | PASS | — | Unchanged. Visible Convert button + ⌘/Ctrl+Enter listener (`converter-page.tsx:104-114`). `ctrlKey` branch still untested (D-m11). |
| AS-024 | PASS | — | Unchanged. `disabled={isEmpty \|\| loading}` (`:148`) + "Paste some HTML first." (`:149,170-174`). |
| AS-025 | PASS | — | Unchanged. `inFlight` ref guards both click and keydown; the two-keydown test pins it. Now reinforced by the deferred-promise test. |
| AS-026 | PASS | — | Unchanged. `TextEncoder().encode(...).length` (`:202`); multi-byte fixture pins the KB rendering. |
| AS-027 | PASS | — | Enabled only on `result.ok && errors.length === 0 && !loading`. Mutating `disabled` to `false` fails 5 tests. |
| AS-028 | PASS | — | Native `disabled` with `result === null`; two dedicated tests fail under mutation. |
| AS-029 | PASS | — | Unchanged. `role="alert"` render (`converter-results.tsx:43-47`), Copy left disabled. |
| AS-030 | PASS | minor | Unchanged. Note renders unconditionally outside any `<details>`; test still not falsifiable (D-m2). |
| **AS-031** | **PASS** | minor | **Round-4 FAIL cleared.** `application/json` is written first (`converter-page.tsx:85`) and the page-level test pins the MIME array. The return value is now pinned (MUT J fails). Minor: `execCommand`'s own return is not independently pinned (D-o1, MUT Q). |
| **AS-032** | **PASS** | — | **Round-4 FAIL cleared.** Synchronous `copy` event via `execCommand`; the guard now covers the entire `navigator.clipboard` surface *including property access*, plus the `fired`-flag test that rejects an async implementation. MUT K fails. |
| AS-033 | PASS | minor | `role="status"` paste instruction (`:177-185`), gated on success only; a test asserts `queryByRole("status")` is absent before any copy. Minor: the live region is still mounted together with its text (D-n6). |
| **AS-034** | **PASS** | minor | **Round-4 FAIL cleared on both routes.** D-N2: stale in-flight copy is now impossible (MUT L fails). D-N4: failure is announced via `role="alert"`, the overriding `aria-label` is gone, and the message persists (MUT M fails). Minors remain: D-o3 (stale payload after *editing* inputs) and D-o4 (a throw from `writeToClipboard` is silent). |
| AS-035 | PASS | minor | Unchanged. Real `contentEditable` target; the attribute itself still untested (D-m4). |
| AS-036 | PASS | — | Unchanged. Affirmative `PRESENT \| NOT PRESENT`; byte length via `Blob.size` with a multi-byte guard. |
| AS-037 | PASS | minor | Unchanged. Separate `text/plain`-only button. Now consumes a boolean that *is* asserted (D-N3 closed); weaker failure label remains (D-m15). |
| AS-038 | PASS | — | Unchanged. `customCode.trim().length > 0` (`converter-results.tsx:32-33`). |
| AS-106 | PASS | minor | Unchanged. Read-only `<pre>` with the Page Settings label. Inert `<label htmlFor>` (D-m9); echoes the escaped JS (D-m13). |
| **AS-119** | **FAIL** | **major** | **D-O1 (new).** The code is correct, but its only test is vacuous. Mutation-confirmed: deleting the errors clause entirely — `disabled={loading \|\| !result?.ok}` — keeps **94/94 green**. See below. |
| AS-120 | PASS | — | Unchanged. All warnings rendered unconditionally in a `max-h-40 overflow-y-auto` container; no cap, no expander. |
| AS-140 | PASS | minor | Unchanged. Both importers are `"use client"`; no server-only imports. Satisfied in fact, unenforced by tooling (D-m8). |

No previously-passing assertion regressed. Three round-4 FAILs (AS-031, AS-032, AS-034)
are cleared. One previously-passing assertion (AS-119) is downgraded on re-examination —
its verdict in rounds 1–4 was granted on a test that does not test it.

## Defects

### Blockers
None.

### Majors

**D-O1 — major — AS-119's only test is vacuous; the errors guard is a free mutation.**
`components/webflow-tool/converter-page.test.tsx:183-199`.
The test mocks a result with `ok: true, errors: ["Something went wrong."]`, clicks
Convert, then immediately does:
```js
await waitFor(() =>
  expect(screen.getByRole("button", { name: /copy for webflow/i })).toBeDisabled(),
)
```
At the moment `waitFor` first polls, `result` is still `null` and `loading` is `true`, so
the button is *already* disabled for reasons that have nothing to do with `errors`.
`waitFor` resolves on its first tick and never observes the post-resolution state the
assertion is about. Mutation-confirmed (MUT P): replacing the `disabled` expression at
`converter-page.tsx:159` with `disabled={loading || !result?.ok}` — removing the errors
guard entirely, so a payload with hard errors becomes copyable — leaves the suite at
**94/94 passed**. AS-119 has, and has always had, zero regression protection. The second
half of AS-119 ("no override") is also untested: nothing asserts the absence of a
"copy anyway" control.
Fix: before asserting `toBeDisabled()`, await an observable post-resolution signal — e.g.
`await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument())`
or await `aria-busy="false"` on the Convert button — then assert the copy button is
disabled. Add a sibling test with `errors: []` asserting it is *enabled*, so the guard is
pinned in both directions.

### Minors

New this round:

**D-o1 — `execCommand`'s return value is dead under test.** `clipboard.ts:54`. MUT Q
(`return fired && !threw`, dropping `result`) → **94/94 passed**. The
"returns false when execCommand fails" test mocks `execCommand` to return `false`
*without firing the handler*, so `fired === false` alone explains the result. No test
isolates handler-fires-but-`execCommand`-returns-`false` — the real Firefox/Safari
refusal signal.

**D-o2 — the read-back fidelity comparison is not independently pinned.** `clipboard.ts:32`
is correctly `written !== item.data`, but MUT I (revert to `!written`) → **94/94 passed**,
because `test_setData_silent_rejection_returns_false` uses `data: "{}"` against a
`getData` returning `""`, which both forms catch. The fidelity case F097's commit message
claims to cover (a browser that *truncates or transforms* rather than drops) has no test.
Add one whose `getData` returns a mangled non-empty value.

**D-o3 — `result` survives an edit to the inputs, so a stale payload stays copyable.**
`converter-page.tsx:33,53-80`. `result` is invalidated only by a new conversion, never by
a change to `html`/`css`/`js`. After a successful convert the user can rewrite the HTML
entirely and the Copy button remains enabled against the *previous* conversion; if a copy
had already succeeded, "Copied!" and the `role="status"` paste instruction also persist
for the full 3 s while referring to a payload that no longer matches the editor or the
preview. This is the same class of false confirmation as round-4's D-N2, but via the edit
path rather than the in-flight path. Recorded as minor rather than major because no M6
assertion names input-dirtying; it is a genuine user-facing hazard and warrants a new
assertion.

**D-o4 — a throw from `writeToClipboard` is completely silent.** `converter-page.tsx:84`
calls it unguarded. `clipboard.ts` is defensive but not throw-proof:
`e.clipboardData!.getData` (`:31`) is outside the `try`, as are
`document.addEventListener` (`:39`) and `removeEventListener` (`:51`). On a throw the
click handler propagates, no alert renders, and the button still reads "Copy for Webflow" —
the user gets no feedback at all. Wrap the call in `try/catch` and set `copyStatus: "error"`.

**D-o5 — duplicate MIME types produce a false negative.** `clipboard.ts:18-37`. Two items
sharing a `mimeType`: the second `setData` overwrites, the read-back then compares item 1
against the final value, mismatches, and returns `false` despite a successful write.
Untested. (Not reachable from the current two callers.)

**D-o6 — the clipboard tests never exercise the real DOM path.** `document.addEventListener`
is stubbed in `beforeEach`, so the listener is never registered and the mock keys on the
captured handler variable rather than the event type. `{ once: true }` (`:39`) is never
validated, and listening for the wrong event name would still pass.

**D-o7 — the failure state's non-expiry is untested.** MUT O (restore the auto-clear to
the error branch at `converter-page.tsx:93`) → **94/94 passed**. The persistence F098
added is correct but free to regress. Needs fake timers.

**D-o8 — removing the static `aria-label` is not pinned.** MUT N (reintroduce
`aria-label="Copy for Webflow"`) → **94/94 passed**. The `role="alert"` region carries the
announcement, so the behaviour survives — but the WCAG 2.5.3 label-in-name fix would
silently regress. Query the button by its failure name after a failed copy.

**D-o9 — duplicated announcement.** On failure both the button label and the sr-only
`role="alert"` read "Copy failed — try again", so AT users hear it twice.

Carried forward, all still open, all still minor: **D-m1** dead `seqRef`; **D-m2** AS-030
not falsifiable; **D-m4** contentEditable untested; **D-m5** success instruction expires
after 3 s; **D-m6** `ConverterResults` copy timer never cleared; **D-m7** engine dedupes
warnings via `new Set`; **D-m8** AS-011/AS-140 unenforced by lint; **D-m9** inert
`<label htmlFor>`; **D-m10** empty `data-testid` div in production markup; **D-m11**
`ctrlKey` untested; **D-m13** escaped JS echoed back to the user; **D-m14** escape
narrower than the HTML spec; **D-m15** partial write corrupts the clipboard while
returning `false`; **D-m16** bare `catch {}` swallows conversion diagnostics; **D-n6**
`role="status"` mounted with its text; **D-n7** empty-string payload indistinguishable
from silent rejection; **D-n8** the 3 s timer and its unmount cleanup are untested;
**D-n9** `:83` vs `:159` disagree about `result.json`.
(**D-m18** is closed — `clipboard.test.ts` now uses `vi.spyOn(document, "execCommand")`
throughout except the one legacy assignment at `:87`.)

Round-4 follow-up status: **FU-N delivered on its two load-bearing clauses** (happy-path
`toBe(true)`, widened async guard) and on the read-back tightening; the no-partial-commit
clause (D-m15) and the fidelity test (D-o2) were not attempted. **FU-O partially
delivered** — the `loading` gate and the failure-persistence split landed; the `:83`/`:159`
consistency clause (D-n9) and the fake-timer coverage (D-n8/D-o7) were not. **FU-P
partially delivered** — the `aria-label` removal and the `role="alert"` region landed;
the unconditional-empty `role="status"` clause (D-n6) was not, and none of the three are
pinned by role-name queries (D-o8). **FU-K-remainder, FU-I, FU-J still not attempted.**

## Recommended follow-up features

**FU-Q (major — closes D-O1; hardens AS-119). BLOCKS M6 GREEN.**
Make the AS-119 errors guard falsifiable. `test_AS_119_copy_button_disabled_when_ok_but_has_errors`
currently asserts `toBeDisabled()` inside a `waitFor` that resolves on its first tick,
while `result` is still `null` and `loading` is still `true` — so it observes the
pre-resolution state and says nothing about errors. Deleting the entire
`(result?.errors?.length ?? 0) > 0` clause from `converter-page.tsx:159`, which makes a
payload with hard conversion errors copyable, keeps all 94 tests green. Rewrite the test
to first await an observable post-resolution signal — the rendered error text via
`await screen.findByText(/something went wrong/i)`, or `aria-busy="false"` on the Convert
button — and only then assert the copy button is disabled. Add the mirror-image test:
same mock with `errors: []`, asserting the button becomes *enabled*, so the guard is
pinned in both directions and cannot be satisfied by an always-disabled button. Also add
the missing second half of AS-119: assert that after a conversion carrying errors there is
no enabled control whose accessible name matches /anyway|force|override|copy invalid/i,
so no future escape hatch can be introduced silently. Verify by re-running MUT P
(`disabled={loading || !result?.ok}`) and confirming the suite now fails.

**FU-R (minor — closes D-o3, D-o4, D-n9; hardens AS-034).** Invalidate the conversion
result when the inputs change, and never let a copy fail silently. Today `result` is
cleared only by a new conversion, so after a successful convert the user can rewrite the
HTML completely and still copy — and still be shown "Copied!" and the Designer paste
instruction — for the *previous* payload, which matches neither the editor nor the live
preview. Add an effect keyed on `[html, css, js]` that resets `result` and `copyStatus`
(or gate the copy button on a dirty flag), and pin it with a test that converts, edits the
HTML, and asserts the copy button is disabled and no `role="status"` region remains.
Separately, wrap the `writeToClipboard` call at `converter-page.tsx:84` in `try/catch` and
set `copyStatus: "error"` in the catch — the function is defensive but not throw-proof
(`getData` at `clipboard.ts:31` and both `addEventListener` calls sit outside any guard),
and today a throw renders no alert at all and leaves the button reading "Copy for Webflow".
Pin with a test where the mock throws. Finally make `:83`'s `!result.json` guard and the
`:159` `disabled` expression agree so no enabled control can produce a silent no-op.

**FU-S (minor — closes D-o1, D-o2, D-o5, D-o6, D-o7, D-o8, D-n6, D-n8, D-m15, D-m18).**
Close the remaining falsifiability gaps around the now-correct clipboard and copy-status
code, all of which are free mutations today. In `clipboard.test.ts`: add a test where the
copy handler fires normally but `execCommand` returns `false`, so dropping `result` from
the return expression is caught (MUT Q currently passes); add a test whose `getData`
returns a *mangled non-empty* value so the `written !== item.data` fidelity comparison is
pinned rather than merely coincidentally exercised (MUT I currently passes); stop stubbing
`document.addEventListener` in `beforeEach` so the real listener registration, the event
name, and `{ once: true }` are exercised; restructure the write loop so nothing is
committed until every `setData` succeeds, with a two-item test where the second throws
asserting no partial payload; and replace the last raw `document.execCommand = vi.fn()`
assignment at `:87` with `vi.spyOn`. In `converter-page.test.tsx`: add fake-timer tests
pinning that the success state clears after 3 s, that the failure state does *not* (MUT O
currently passes), and that unmounting with a pending timer runs the cleanup; and query
the copy button by `getByRole("button", { name: /copy failed/i })` after a failed copy so
reintroducing the static `aria-label` fails (MUT N currently passes). Render the success
`role="status"` region unconditionally and empty, populating only its text on success.

**FU-K-remainder / FU-I / FU-J (carried forward, minor).** Unchanged from rounds 3–4:
widen the `</script>` escape to `/<\/script/gi` and stop echoing the escaped form back to
the caller so AS-106 and AS-037 reproduce the user's JS byte-for-byte; falsifiable AS-030
and AS-035 tests; clear `ConverterResults`' copy timer on unmount; delete the dead
`seqRef`; replace the inert `<label htmlFor>`; remove the empty
`data-testid="conversion-result"` div; add a `ctrlKey` shortcut test; log the exception
swallowed at `converter-page.tsx:67-75`; add an ESLint `no-restricted-imports` rule
enforcing the AS-011/AS-140 client boundary.

## Mutation matrix

All mutations applied to a clean tree and fully reverted;
`git status --porcelain -- lib components` verified empty after each.

```
MUT J  return false unconditionally               (clipboard.ts:54)
       -> FAIL 2 tests                                   (2 failed | 92 passed)  GOOD  (was BAD in R4 — D-N3 closed)
MUT K  add navigator.clipboard?.writeText?.("x")  (clipboard.ts:41)
       -> FAIL test_no_async_clipboard_api_used          (1 failed | 93 passed)  GOOD  (was BAD in R4 — D-N1 closed)
MUT L  drop `loading ||` from copy disabled       (converter-page.tsx:159)
       -> FAIL test_copy_disabled_during_convert         (1 failed | 93 passed)  GOOD  (new — D-N2 closed)
MUT M  strip role="alert" from failure region     (converter-page.tsx:192)
       -> FAIL 2 tests                                   (2 failed | 92 passed)  GOOD  (new — D-N4 closed)

MUT P  delete the AS-119 errors guard             (converter-page.tsx:159)
       -> ALL PASS (94 passed)                                                   BAD   (D-O1, major)
MUT Q  ignore execCommand's return value          (clipboard.ts:54)
       -> ALL PASS (94 passed)                                                   BAD   (D-o1, minor)
MUT I  revert read-back to truthiness `!written`  (clipboard.ts:32)
       -> ALL PASS (94 passed)                                                   BAD   (D-o2, minor)
MUT N  reintroduce aria-label="Copy for Webflow"  (converter-page.tsx:158)
       -> ALL PASS (94 passed)                                                   BAD   (D-o8, minor)
MUT O  re-add the failure auto-clear              (converter-page.tsx:93)
       -> ALL PASS (94 passed)                                                   BAD   (D-o7, minor)
```

Round-4's four BAD mutations against majors are all now GOOD. The five surviving
mutations are one major (MUT P / AS-119) and four minors around code that is itself
correct.

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:44321) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:44330) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  94 passed (94)
   Start at  02:24:01
   Duration  2.28s (transform 518ms, setup 2.28s, import 573ms, tests 1.54s, environment 2.60s)

[exited with code 0]
```

### `npx tsc --noEmit`

```
---TSC exit 0---
```
(no diagnostics emitted)

### `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

[exited with code 0]
```

### Blast radius since round 4

```
$ git diff --stat HEAD~2 HEAD -- lib components
 components/webflow-tool/converter-page.test.tsx | 49 +++++++++++++++++++++++--
 components/webflow-tool/converter-page.tsx      | 23 ++++++++++--
 lib/webflow-converter-client/clipboard.test.ts  | 33 ++++++++++++++---
 lib/webflow-converter-client/clipboard.ts       |  2 +-
 4 files changed, 94 insertions(+), 13 deletions(-)
```

### Tree integrity

```
$ git status --porcelain -- lib components
(empty)
```
No code, test, or contract file was modified by this review.
