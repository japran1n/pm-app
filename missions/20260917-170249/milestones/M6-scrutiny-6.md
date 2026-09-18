# M6 scrutiny report (round 6 — final re-scrutiny after F099)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Rounds: 1 (RED) · 2 (AMBER) · 3 (AMBER, 5 majors) · 4 (AMBER, 4 majors) · 5 (AMBER, 1 major) · **6 (GREEN)**

Verdict: **GREEN — 0 blockers, 0 majors.**

The single round-5 major (D-O1 / AS-119) is closed and mutation-confirmed. Blast radius
since round 5 is one test file (`converter-page.test.tsx`, commit `f2289845`); no source
file changed, so every assertion whose code lies outside that file carries its round-5
verdict forward unchanged.

Suite: 9 files / **95 tests passed** (was 94). `npx tsc --noEmit` clean. `npm run lint` clean.

## What the code does (AS-119 path)

`converter-page.tsx:159` gates the Copy button on
`disabled={loading || !result?.ok || (result?.errors?.length ?? 0) > 0}`. A conversion that
returns `ok: true` alongside a non-empty `errors` array therefore renders a natively
disabled button; there is no alternate control, no confirm dialog, and no query parameter
that bypasses the expression. The button's accessible name is its own visible text, so an
override control would have to be a distinct rendered element — none exists in the tree.

## Round-5 major — re-verified

| Round-5 defect | Status | Evidence |
|---|---|---|
| **D-O1** AS-119's only test vacuous; errors guard a free mutation | **CLOSED** | `converter-page.test.tsx:183-205` now awaits two post-resolution signals (`queryByText(/converting/i)` absent, then `getByText(/1 elements/i)` present) before asserting `toBeDisabled()`. A sibling `test_AS_119_copy_button_enabled_when_ok_and_no_errors` (`:207-225`) asserts the mirror case. **MUT P** (delete the errors clause) → **1 failed / 94 passed** (was 95/95 green in round 5). **MUT P2** (`disabled={true}`) → **8 failed / 87 passed**, so the guard is pinned in both directions and cannot be satisfied by an always-disabled button. |

The tests were confirmed to be genuinely post-resolution, not coincidentally passing: MUT P
fails on the *disabled* test specifically, which is only possible if the assertion runs
after `result` is populated and `loading` is false.

## Assertion verdicts

Standard applied: a test that only confirms the implementation rather than the assertion's
intent means the assertion FAILS even when it passes today.

| ID | Verdict | Sev | Reason |
|---|---|---|---|
| AS-011 | PASS | — | Unchanged. No `.from()`/RPC/storage in `webflow-converter.ts`; only `auth.getUser()`. Unenforced by tooling (D-m8). |
| AS-023 | PASS | — | Unchanged. Visible Convert button + ⌘/Ctrl+Enter listener. `ctrlKey` branch untested (D-m11). |
| AS-024 | PASS | — | Unchanged. `disabled={isEmpty \|\| loading}` + "Paste some HTML first." |
| AS-025 | PASS | — | Unchanged. `inFlight` ref guards click and keydown. |
| AS-026 | PASS | — | Unchanged. `TextEncoder().encode(...).length`; multi-byte fixture pins KB rendering. |
| AS-027 | PASS | — | Unchanged. MUT P2 (always-disabled) and MUT P (never-guarded) both fail the suite. |
| AS-028 | PASS | — | Unchanged. Native `disabled` with `result === null`. |
| AS-029 | PASS | — | Unchanged. `role="alert"` render; Copy left disabled. |
| AS-030 | PASS | minor | Unchanged. Test still not falsifiable (D-m2). |
| AS-031 | PASS | minor | Re-verified this round. `application/json` written first (`:85`); **MIME mutation** (`application/json` → `text/plain`) → **1 failed**. Return value pinned both ways: MUT J (`return false`) → 2 failed; MUT J2 (`return true`) → 6 failed. Minor: `execCommand`'s own return unpinned (D-o1, MUT Q). |
| AS-032 | PASS | — | Re-verified. MUT K (touch `navigator.clipboard.writeText`) → **1 failed**; the guard spies the whole async surface including the property getter. MUT J2 also fails the synchronous-fire test. |
| AS-033 | PASS | minor | Unchanged. `role="status"` paste instruction gated on success. D-n6 open. |
| AS-034 | PASS | minor | Re-verified. MUT L (drop `loading \|\|`) → 1 failed; MUT M (strip `role="alert"`) → 2 failed. Minors D-o3 (stale payload after editing inputs) and D-o4 (silent throw) remain. |
| AS-035 | PASS | minor | Unchanged. contentEditable attribute untested (D-m4). |
| AS-036 | PASS | — | Unchanged. Affirmative `PRESENT \| NOT PRESENT`; byte length via `Blob.size`. |
| AS-037 | PASS | minor | Unchanged. Separate `text/plain`-only button; D-m15 open. |
| AS-038 | PASS | — | Unchanged. `customCode.trim().length > 0`. |
| AS-106 | PASS | minor | Unchanged. D-m9, D-m13 open. |
| **AS-119** | **PASS** | minor | **Round-5 FAIL cleared.** Errors guard now falsifiable in both directions (MUT P, MUT P2). Minor: the second half — "no override" — is still only satisfied in fact, not asserted (D-p1). |
| AS-120 | PASS | — | Unchanged. All warnings rendered unconditionally; no cap, no expander. |
| AS-140 | PASS | minor | Unchanged. Both importers `"use client"`; unenforced by tooling (D-m8). |

No previously-passing assertion regressed. All 21 M6 assertions PASS.

## Defects

### Blockers
None.

### Majors
None.

### Minors

**D-p1 (new) — AS-119's "no override" clause is satisfied in fact but unasserted.**
Nothing in the suite asserts the *absence* of an enabled control matching
/anyway|force|override|copy invalid/i after an errored conversion. A future "copy anyway"
escape hatch could be added without failing a test. Not raised above minor: no such control
exists today and the disabled path is now pinned.

Carried forward from round 5, all still open, all still minor and all re-confirmed by
mutation this round where noted: **D-o1** `execCommand`'s return value dead under test
(MUT Q → 95/95 pass); **D-o2** read-back fidelity comparison unpinned (MUT I → 95/95 pass);
**D-o3** `result` survives an edit to the inputs, so a stale payload stays copyable;
**D-o4** a throw from `writeToClipboard` is completely silent; **D-o5** duplicate MIME
types produce a false negative; **D-o6** clipboard tests never exercise the real DOM
listener path; **D-o7** failure-state non-expiry untested; **D-o8** removing the static
`aria-label` unpinned; **D-o9** duplicated announcement on failure.

Carried forward from rounds 3–4, all still minor: **D-m1** dead `seqRef`; **D-m2** AS-030
not falsifiable; **D-m4** contentEditable untested; **D-m5** success instruction expires
after 3 s; **D-m6** `ConverterResults` copy timer never cleared; **D-m7** engine dedupes
warnings via `new Set`; **D-m8** AS-011/AS-140 unenforced by lint; **D-m9** inert
`<label htmlFor>`; **D-m10** empty `data-testid` div in production markup; **D-m11**
`ctrlKey` untested; **D-m13** escaped JS echoed back; **D-m14** escape narrower than the
HTML spec; **D-m15** partial write corrupts the clipboard while returning `false`;
**D-m16** bare `catch {}` swallows diagnostics; **D-n6** `role="status"` mounted with its
text; **D-n7** empty-string payload indistinguishable from silent rejection; **D-n8** the
3 s timer and its unmount cleanup untested; **D-n9** `:83` vs `:159` disagree about
`result.json`.

Round-5 follow-up status: **FU-Q delivered** on its two load-bearing clauses (post-resolution
await, mirror-image enabled test) — MUT P is now caught. Its third clause (assert no
override control) was not attempted and is recorded as D-p1. **FU-R, FU-S,
FU-K-remainder, FU-I, FU-J not attempted**; none block GREEN.

## Recommended follow-up features

None block M6. The three below are quality debt and can be scheduled after the milestone.

**FU-T (minor — closes D-p1, D-o8, D-o7, D-n8, D-n6).** Pin the copy button's accessible
name and status lifetimes. Add an assertion that after a conversion carrying hard errors
there is no *enabled* control whose accessible name matches /anyway|force|override|copy
invalid/i, completing the untested half of AS-119. Query the copy button by
`getByRole("button", { name: /copy failed/i })` after a failed copy so reintroducing the
static `aria-label="Copy for Webflow"` fails (MUT N is free today). Add fake-timer tests
pinning that the success state clears after 3 s, that the failure state does *not* (MUT O
is free today), and that unmounting with a pending timer runs the cleanup. Render the
success `role="status"` region unconditionally and empty, populating only its text.

**FU-U (minor — closes D-o1, D-o2, D-o5, D-o6, D-m15, D-m18-remainder).** Close the
falsifiability gaps in `clipboard.test.ts`. Add a test where the copy handler fires
normally but `execCommand` returns `false`, so dropping `result` from
`return result && fired && !threw` is caught (MUT Q passes today). Add a test whose
`getData` returns a *mangled non-empty* value so the `written !== item.data` fidelity
comparison is pinned rather than coincidentally exercised (MUT I passes today). Stop
stubbing `document.addEventListener` in `beforeEach` so real listener registration, the
event name, and `{ once: true }` are exercised. Restructure the write loop so nothing is
committed until every `setData` succeeds, with a two-item test where the second throws
asserting no partial payload. Replace the last raw `document.execCommand = vi.fn()`
assignment with `vi.spyOn`.

**FU-V (minor — closes D-o3, D-o4, D-n9).** Invalidate the conversion result when the
inputs change, and never let a copy fail silently. Today `result` is cleared only by a new
conversion, so after a successful convert the user can rewrite the HTML completely and
still copy — and still see "Copied!" and the Designer paste instruction — for the previous
payload. Add an effect keyed on `[html, css, js]` resetting `result` and `copyStatus`, and
pin it with a test that converts, edits the HTML, and asserts the copy button is disabled
with no `role="status"` region left. Separately wrap the `writeToClipboard` call at
`converter-page.tsx:84` in `try/catch` setting `copyStatus: "error"` — `getData` at
`clipboard.ts:31` and both `addEventListener` calls sit outside any guard, so a throw today
renders no alert at all. Finally make `:83`'s `!result.json` guard and the `:159` `disabled`
expression agree.

## Mutation matrix

All mutations applied to a clean tree and fully reverted; `git status --porcelain -- lib
components` verified empty after each batch.

```
MUT P   delete the AS-119 errors guard            (converter-page.tsx:159)
        disabled={loading || !result?.ok}
        -> FAIL test_AS_119_..._disabled_when_ok_but_has_errors
                                                  (1 failed | 94 passed)  GOOD  (was BAD in R5 — D-O1 CLOSED)
MUT P2  always disabled                           (converter-page.tsx:159)
        -> FAIL 8 tests incl. ..._enabled_when_ok_and_no_errors
                                                  (8 failed | 87 passed)  GOOD  (guard pinned both ways)
MUT L   drop `loading ||`                         (converter-page.tsx:159)
        -> FAIL test_copy_disabled_during_convert (1 failed | 94 passed)  GOOD  (D-N2 still closed)
MUT M   strip role="alert"                        (converter-page.tsx:192)
        -> FAIL 2 tests                           (2 failed | 93 passed)  GOOD  (D-N4 still closed)
MUT S   application/json -> text/plain            (converter-page.tsx:85)
        -> FAIL test_AS_033_clicking_copy_calls_writeToClipboard_with_json_payload
                                                  (1 failed | 73 passed of the page suite)  GOOD  (AS-031 MIME pinned)
MUT J   return false unconditionally              (clipboard.ts:54)
        -> FAIL 2 tests                           (2 failed | 93 passed)  GOOD
MUT J2  return true unconditionally               (clipboard.ts:54)
        -> FAIL 6 tests                           (6 failed | 89 passed)  GOOD  (return pinned both ways)
MUT K   add navigator.clipboard?.writeText?.("x") (clipboard.ts:39)
        -> FAIL test_no_async_clipboard_api_used  (1 failed | 94 passed)  GOOD  (AS-032 still closed)

MUT Q   ignore execCommand's return value         (clipboard.ts:54)
        -> ALL PASS (95 passed)                                           BAD   (D-o1, minor)
MUT I   revert read-back to truthiness `!written`  (clipboard.ts:32)
        -> ALL PASS (95 passed)                                           BAD   (D-o2, minor)
```

Every mutation that targets a named M6 assertion is now caught. The two surviving free
mutations both sit on code that is itself correct and neither changes an assertion's
observable behaviour.

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:48185) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:48196) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  95 passed (95)
   Start at  02:33:07
   Duration  2.27s (transform 491ms, setup 2.30s, import 557ms, tests 1.56s, environment 2.60s)

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

### Blast radius since round 5

```
$ git show --stat f2289845 -- lib components
 components/webflow-tool/converter-page.test.tsx | +34 / -3
 1 file changed
```
No source file changed since round 5.

### Tree integrity

```
$ git status --porcelain -- lib components
(empty)
```
No code, test, or contract file was modified by this review.
