# M6 scrutiny report (round 4 — re-scrutiny after F095–F096)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Round-1: `M6-scrutiny-1.md` (RED) · Round-2: `M6-scrutiny-2.md` (AMBER) · Round-3: `M6-scrutiny-3.md` (AMBER, 5 majors)

Verdict: **AMBER — 0 blockers, 4 majors. NOT GREEN.**

Three of the five round-3 majors are genuinely closed and mutation-verified. Two are
only half-closed: AS-032's new test guards a single method name rather than the API, and
the "stale Copied!" fix covers the *completed* re-convert but leaves the *in-flight*
window wide open — probe-confirmed below, the copy button stays enabled during
"Converting…", copies the **previous** payload, and renders "Copied!". Two further
majors surfaced this round: the happy-path return value of `writeToClipboard` is
completely unpinned (`return false` unconditionally keeps 93/93 green), and the failure
state has no accessible name and no live region at all.

Blast radius since round 3 is exactly 5 files (2 source +17 lines, 3 test +138 lines):
`clipboard.ts`, `converter-page.tsx`, `clipboard.test.ts`, `converter-page.test.tsx`,
`webflow-converter.test.ts`. Every assertion whose code is outside those files carries
its round-3 verdict forward unchanged.

Suite: 9 files / **93 tests passed** (was 89). `npx tsc --noEmit` clean. `npm run lint`
clean. **A green suite is again not evidence** — see the mutation matrix.

## Round-3 majors — re-verified

| Round-3 defect | Status | Evidence |
|---|---|---|
| D-M4 `setData` silent rejection returns `true` | **CLOSED** | `clipboard.ts:26-37` reads every MIME back with `getData` inside the same handler. MUT F (delete the read-back block) → `test_setData_silent_rejection_returns_false` fails. |
| D-M5 `preventDefault()` unpinned | **CLOSED** | `clipboard.test.ts:174-197` captures the spy and asserts it. MUT E (delete `e.preventDefault()`) → 1 failed / 92 passed. Round 3 had this at 10/10 green. |
| D-M6 AS-032 unpinned | **HALF-CLOSED → D-N1** | `test_no_async_clipboard_api_used` stubs only `navigator.clipboard.write`. Inserting `navigator.clipboard?.writeText?.(...)` before `execCommand` keeps the whole suite green (independently reproduced by the parallel reviewer). The assertion forbids the async Clipboard API; the test forbids one method of it. |
| D-m12 vacuous `</script>` escape test | **CLOSED** | `webflow-converter.test.ts:115-135` now captures `mockConvert.mock.calls[0]` and asserts on the actual HTML (`toContain("<\\/script>")`). MUT D (revert the escape) → 1 failed / 92 passed. Round 3 had this at 8/8 green. |
| D-M7 stale "Copied!" on re-convert | **HALF-CLOSED → D-N2** | `converter-page.tsx:61` sets `copyStatus` to `"idle"` at the top of `handleConvert`; MUT G (remove that line) → `test_copystatus_reset_on_reconvert` fails. But the fix only covers the label. `result` is never cleared and the copy button's `disabled` expression (`:154`) ignores `loading`, so the whole in-flight window is a live false-confirmation path. |

D-M8 (round 3) is **downgraded to minor**: the only producer of `ok: true` is
`webflow-converter.ts:74-84`, which always sets `json: JSON.stringify(result.payload)`
— never empty. The guard/`disabled` mismatch at `converter-page.tsx:83` vs `:154` is a
latent defensive-code inconsistency, not a reachable user path.

## Assertion verdicts

Standard applied: a test that only confirms the implementation rather than the
assertion's intent means the assertion FAILS even when it passes today.

| ID | Verdict | Sev | Reason |
|---|---|---|---|
| AS-011 | PASS | — | Unchanged since round 3. No `.from()`/RPC/storage in `webflow-converter.ts`; only `auth.getUser()`. Unenforced by tooling (D-m8). |
| AS-023 | PASS | — | Unchanged. Visible Convert button + ⌘/Ctrl+Enter listener (`converter-page.tsx:99-109`). `ctrlKey` still untested (D-m11). |
| AS-024 | PASS | — | Unchanged. `disabled={isEmpty \|\| loading}` + "Paste some HTML first." (`:143,163-167`). |
| AS-025 | PASS | — | Unchanged. `inFlight` ref guards click and keydown; two-keydown test pins it. |
| AS-026 | PASS | — | Unchanged. `TextEncoder().encode(...).length` (`:185`); multi-byte fixture pins the KB. |
| AS-027 | PASS | — | Unchanged. Enabled only on `result.ok && errors.length === 0`. |
| AS-028 | PASS | — | Unchanged. Native `disabled` with no prior conversion. |
| AS-029 | PASS | — | Unchanged. `role="alert"` render (`converter-results.tsx:43-47`), Copy left disabled. |
| AS-030 | PASS | minor | Unchanged. Note renders unconditionally outside any `<details>`; test still not falsifiable (D-m2). |
| **AS-031** | **FAIL** | **major** | **D-N3.** The `application/json` delivery *code* is now correct and its failure paths are pinned. But **no test asserts the function ever returns `true`.** Mutating `clipboard.ts:54` to `return false;` — copy never works for any user, "Copied!" never appears — keeps **93/93 green**. Round-3's FU-L asked for exactly this assertion; it was skipped. |
| **AS-032** | **FAIL** | **major** | **D-N1.** Implementation correct (synchronous `copy` event). The new test pins only `navigator.clipboard.write`; `writeText`, `ClipboardItem`, and `navigator.clipboard.read*` are unguarded and a regression to any of them ships green. |
| AS-033 | PASS | minor | `role="status"` paste instruction (`:170-178`), gated on success only, page-level test pins it. Minor: the live region is conditionally mounted with its text, which many screen readers do not announce (D-n6). |
| **AS-034** | **FAIL** | **major** | Two probe-confirmed routes. **D-N2:** during an in-flight re-convert the copy button stays enabled against the *previous* `result`, writes the old payload, and shows "Copied!" while the page reads "Converting…". **D-N4:** the failure state has no accessible name and no live region — probe returns `byName_copyFailed=false`, `byName_copyForWebflow_still=true`, `liveRegions=0`. For an AT user, a clipboard failure is completely silent. |
| AS-035 | PASS | minor | Unchanged. Real `contentEditable` target; attribute still untested (D-m4). |
| AS-036 | PASS | — | Unchanged. Affirmative `PRESENT \| NOT PRESENT`; byte length via `Blob.size` with a multi-byte guard. |
| AS-037 | PASS | minor | Unchanged. Separate `text/plain`-only button; consumes the same unasserted boolean (D-N3), weaker failure label (D-m15). |
| AS-038 | PASS | — | Unchanged. `customCode.trim().length > 0` (`converter-results.tsx:32-33`). |
| AS-106 | PASS | minor | Unchanged. Read-only `<pre>` with the Page Settings label. Inert `<label htmlFor>` (D-m9); echoes the escaped JS (D-m13). |
| AS-119 | PASS | — | Unchanged. Copy gated on `ok && errors.length === 0`; errors rendered even when `ok === true`; no override path. |
| AS-120 | PASS | — | Unchanged. All warnings rendered unconditionally in a `max-h-40 overflow-y-auto` container; no cap, no expander. |
| AS-140 | PASS | minor | Unchanged. Both importers are `"use client"`; no server-only imports. Satisfied in fact, unenforced by tooling (D-m8). |

No previously-passing assertion regressed. AS-031/032/034 remain FAIL — but for
materially different reasons than in round 3: the code defects round 3 named are fixed;
what remains is (a) missing falsifiability on the success path, (b) an over-narrow
AS-032 guard, and (c) two page-level routes round 3 did not reach.

## Defects

### Blockers
None. Every open major is either a missing test around correct code or a UI-state
sequencing bug, not a broken core behaviour.

### Majors

**D-N1 — major — AS-032's guard is one method wide.** `clipboard.test.ts:199-209`.
The assertion says "not the async Clipboard API's `write()`" but its intent is the whole
async API. Adding `navigator.clipboard.writeText(...)` alongside the `execCommand` path
keeps the suite green. Fix: assert that no property of `navigator.clipboard` was invoked
— stub the whole object with a Proxy or spy on `write`, `writeText`, `read`, `readText`
and `ClipboardItem` and assert all are uncalled.

**D-N2 — major — copy is enabled against a stale `result` for the entire in-flight
window.** `converter-page.tsx:53-80` (never clears `result`) and `:154` (`disabled`
ignores `loading`). Probe-confirmed with the real component:
```
M5 copyDisabledDuringInflight = false
M5 writeArgs = [[{"mimeType":"application/json","data":"{\"OLD\":1}"},
                 {"mimeType":"text/plain","data":"{\"OLD\":1}"}]]
M5 copiedShownWhileConverting = true
```
The user edits the HTML, presses Convert, clicks Copy before it resolves, sees
"Copied!" and the Designer paste instruction, and pastes the *previous* conversion.
`test_copystatus_reset_on_reconvert` cannot catch this — it uses a resolved promise, so
the in-flight window never exists in the test. Fix: add `|| loading` to the `disabled`
expression (and/or clear `result` at the top of `handleConvert`), and pin it with a
deferred-promise test that asserts the copy button is disabled while `aria-busy` is true.

**D-N3 — major — nothing asserts `writeToClipboard` ever returns `true`.**
`clipboard.ts:54`, `clipboard.test.ts:42-60`. The three happy-path tests assert the mock
`clipboardData` map was populated, never the return value; `grep "toBe(true)"` on the
file returns nothing. Mutation-verified: `return false;` → **93/93 passed**. A total,
universal copy failure is invisible to the suite, and it propagates to AS-033 and AS-037
which both consume the same boolean. Fix: assert `toBe(true)` on each happy path.

**D-N4 — major — the failure state is inaudible and unnamed.**
`converter-page.tsx:155`. The hardcoded `aria-label="Copy for Webflow"` overrides the
button's text content, so the accessible name never becomes "Copy failed — try again",
and there is no `role="alert"`/`aria-live` region for the failure (the success path does
get `role="status"`). Probe: `byName_copyFailed=false`, `liveRegions=0` after a failed
copy. The existing test (`converter-page.test.tsx:290`) uses `findByText`, asserting
pixels rather than the announcement. This is also a WCAG 2.5.3 label-in-name mismatch in
the success state ("Copied!" visible, "Copy for Webflow" announced). AS-034 requires the
page to show a clear failure message; for an AT user it shows none.

### Minors

New this round:

**D-n5 — the read-back check tests truthiness, not fidelity.** `clipboard.ts:31-32`
uses `if (!written)`. A browser that truncates or transforms the payload (rather than
dropping it) still yields `true`. Compare `written === item.data`.

**D-n6 — `role="status"` is mounted together with its text.** `converter-page.tsx:170-178`.
Live regions inserted into the DOM at the same moment as their content are commonly not
announced; the region should exist and be empty beforehand.

**D-n7 — an empty-string payload is indistinguishable from a silent rejection.**
`clipboard.ts:31`. `getData` returns `""` for a legitimately-written empty string, so
`writeToClipboard([{mimeType, data: ""}])` returns `false`. Currently masked by the
`!result.json` guard; it will surface the moment that guard is removed.

**D-n8 — the 3 s timer is entirely untested and also erases failures.**
`converter-page.tsx:90` applies the same 3000 ms reset to `"error"` as to `"success"`,
so the failure message self-erases into a state indistinguishable from "never clicked".
No test uses fake timers; `setTimeout(..., 0)` and `setTimeout(..., 300000)` are both
free mutations, as is the unmount cleanup at `:93-97`.

**D-n9 — D-M8 downgraded.** `converter-page.tsx:83` vs `:154` disagree about whether
`result.json` gates the copy. Unreachable today because the action always emits a
non-empty `json` with `ok: true`, but the two lines should be made consistent.

Carried forward from rounds 2–3, all still open, all still minor: **D-m1** dead `seqRef`;
**D-m2** AS-030 not falsifiable; **D-m4** contentEditable untested; **D-m5** success
instruction expires after 3 s; **D-m6** `ConverterResults` copy timer never cleared;
**D-m7** engine dedupes warnings via `new Set`; **D-m8** AS-011/AS-140 unenforced by
lint; **D-m9** inert `<label htmlFor>`; **D-m10** empty `data-testid` div in production
markup; **D-m11** `ctrlKey` untested; **D-m13** escaped JS echoed back to the user;
**D-m14** escape narrower than the HTML spec (`/<\/script/gi`); **D-m15** partial write
corrupts the clipboard while returning `false`; **D-m16** bare `catch {}` swallows
conversion diagnostics; **D-m18** `clipboard.test.ts:63` still assigns
`document.execCommand = vi.fn()` raw instead of `vi.spyOn`.
(D-m12 is closed; D-m17 is promoted to D-N4.)

Round-3 follow-up status: **FU-L partially delivered** — the read-back, `preventDefault`
and no-async clauses landed; the "assert the happy path returns `true`" clause (D-N3) was
skipped and the no-async clause was implemented too narrowly (D-N1); the
no-partial-commit clause (D-m15) was not attempted. **FU-M partially delivered** — only
the `copyStatus` reset landed; the `result.json` `disabled` clause and the `aria-label` /
failure-live-region clause were not attempted. **FU-K partially delivered** — the
vacuous-test clause is closed; the widened pattern and the stop-echoing-escaped-JS
clauses were not. **FU-I and FU-J still not attempted.**

## Recommended follow-up features

**FU-N (major — closes D-N3, D-N1, D-n5, D-m15, D-m18; hardens AS-031, AS-032).**
Finish the clipboard-module test hardening that FU-L started. Add `expect(result).toBe(true)`
to every happy-path test in `clipboard.test.ts` so that mutating `writeToClipboard`'s
return to a constant `false` — today a free mutation that keeps all 93 tests green while
breaking copy for every user — fails the suite. Widen `test_no_async_clipboard_api_used`
from a single `write` spy to a guard over the entire async Clipboard API: replace
`navigator.clipboard` with a Proxy (or explicit spies on `write`, `writeText`, `read`,
`readText`) and assert nothing on it was invoked, plus assert `ClipboardItem` was never
constructed, so AS-032 is pinned against the API rather than one method name. Tighten the
read-back comparison at `clipboard.ts:31` from `!written` to `written !== item.data` so a
browser that truncates or transforms a flavour is caught alongside one that drops it, and
add a test whose `getData` returns a mangled value. Restructure the write loop so the
clipboard is not mutated until every `setData` has succeeded, and add a two-item test
where the second throws, asserting both `false` and that no partial payload was
committed. Finally replace the raw `document.execCommand = vi.fn()` assignment with
`vi.spyOn` so the mock cannot leak across test files.

**FU-O (major — closes D-N2, D-n9, D-n8; hardens AS-034).** Close the in-flight
false-confirmation window at the page level. Add `loading` to the copy button's `disabled`
expression at `converter-page.tsx:154` (and consider clearing `result` at the top of
`handleConvert`) so that while a conversion is in flight the user cannot copy — and be
told "Copied!" for — the *previous* conversion's payload; pin it with a deferred-promise
test that starts a second conversion, asserts the copy button is disabled while
`aria-busy` is true, and asserts `writeToClipboard` was not called. Make
`converter-page.tsx:83`'s `!result.json` guard and the `disabled` expression agree, so no
enabled control can ever produce a silent no-op. Split the 3 s auto-reset so it applies
only to the success state — a failure message must persist until the next convert or copy
attempt rather than erasing itself into a state indistinguishable from "never clicked" —
and cover the timer with fake-timer tests that pin both the success expiry and the
failure persistence, plus one that unmounts with a pending timer to exercise the cleanup
effect at `:93-97`.

**FU-P (major — closes D-N4, D-n6; hardens AS-033, AS-034).** Make the copy outcome
perceivable without sight. Remove the hardcoded `aria-label="Copy for Webflow"` from
`converter-page.tsx:155` so the button's accessible name follows its visible text and
"Copy failed — try again" is actually announced, resolving the WCAG 2.5.3 label-in-name
mismatch in the success state at the same time. Give the failure message its own
`role="alert"` region rather than relying on a button label that assistive tech never
re-reads. Render the success `role="status"` region unconditionally and empty, populating
only its text content on success, so screen readers that ignore a live region inserted
together with its content still announce the Designer paste instruction. Pin all three
with role-based queries — `getByRole("button", { name: /copy failed/i })` after a failed
copy, and an assertion that a live region exists in the DOM before any copy is attempted —
so the assertions fail if the `aria-label` is reintroduced.

**FU-K-remainder (minor).** Widen the escape at `webflow-converter.ts:41` to
`/<\/script/gi` so it does not depend on `node-html-parser` being more lenient than the
HTML spec, and stop echoing the escaped form back to the caller: apply the escape only to
the string interpolated into the injected `<script>` tag and return the user's original JS
in `ConvertActionResult.js`, so the read-only `<pre>` (AS-106) and "Copy custom code"
(AS-037) reproduce byte-for-byte what the user typed. Pin with a byte-identity assertion.

**FU-I / FU-J (carried forward, minor).** Unchanged from round 3: falsifiable AS-030 and
AS-035 tests (`closest("details")` is null; `contenteditable="true"`); clear
`ConverterResults`' copy timer on unmount and reset its status when `result` changes;
delete or exercise the dead `seqRef`; replace the inert `<label htmlFor>` on the `<pre>`;
remove the empty `data-testid="conversion-result"` div; add a `ctrlKey` shortcut test; log
the exception swallowed at `converter-page.tsx:67-75`; add an ESLint
`no-restricted-imports` rule enforcing the AS-011/AS-140 client boundary.

## Mutation matrix

All mutations applied to a clean tree and fully reverted; `git status --porcelain -- lib components`
verified empty after each.

```
MUT E  delete e.preventDefault()                  (clipboard.ts:17)
       -> FAIL test_preventDefault_called                 (1 failed | 92 passed)  GOOD (was BAD in R3)
MUT F  remove the getData read-back block         (clipboard.ts:29-37)
       -> FAIL test_setData_silent_rejection_returns_false (1 failed | 92 passed)  GOOD (new)
MUT D  revert the </script> escape                (webflow-converter.ts:41)
       -> FAIL test_script_closing_tag_in_js_escaped       (1 failed | 92 passed)  GOOD (was BAD in R3)
MUT G  remove setCopyStatus("idle") in handleConvert (converter-page.tsx:61)
       -> FAIL test_copystatus_reset_on_reconvert          (1 failed | 92 passed)  GOOD (new)
MUT I  neuter the read-back comparison            (clipboard.ts:32)
       -> FAIL test_setData_silent_rejection_returns_false (1 failed | 12 passed)  GOOD
MUT H  add navigator.clipboard.write([]) call     (clipboard.ts:41)
       -> FAIL test_no_async_clipboard_api_used            (1 failed | 12 passed)  GOOD

MUT J  return false unconditionally               (clipboard.ts:54)
       -> ALL PASS (93 passed)                                                     BAD  (D-N3)
MUT K  add navigator.clipboard.writeText(...)     (clipboard.ts:41)
       -> ALL PASS                                                                 BAD  (D-N1)
```

## Behavioural probes (temporary test file, deleted after the run)

Run against the real `ConverterPage` with only `convertHtmlToWebflow` and
`writeToClipboard` mocked.

```
M5 copyDisabledDuringInflight   = false
M5 writeArgs                    = [[{"mimeType":"application/json","data":"{\"OLD\":1}"},
                                    {"mimeType":"text/plain","data":"{\"OLD\":1}"}]]
M5 copiedShownWhileConverting   = true
M3 byName_copyFailed            = false
M3 byName_copyForWebflow_still  = true
M3 liveRegions (alert/live/status) after a failed copy = 0
```
(The M6 timer probe was inconclusive — `useFakeTimers` was installed after the
`setTimeout` had already been scheduled on the real clock — so D-n8 is recorded from code
inspection of `converter-page.tsx:90` rather than from a probe.)

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:35835) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35849) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  93 passed (93)
   Start at  02:02:02
   Duration  2.28s (transform 492ms, setup 2.29s, import 560ms, tests 1.51s, environment 2.60s)

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

### Blast radius since round 3

```
$ git diff --stat 2def53e0..HEAD -- lib components
 components/webflow-tool/converter-page.test.tsx | 28 +++++++++++
 components/webflow-tool/converter-page.tsx      |  5 ++
 lib/actions/webflow-converter.test.ts           | 48 +++++++++++++++++++
 lib/webflow-converter-client/clipboard.test.ts  | 62 +++++++++++++++++++++++++
 lib/webflow-converter-client/clipboard.ts       | 12 +++++
 5 files changed, 155 insertions(+)
```

### Reachability probe for round-3 D-M8

```
$ grep -n 'json:' lib/actions/webflow-converter.ts
75:    json: JSON.stringify(result.payload),
```
The only `ok: true` return always carries a non-empty `json`, so the enabled-but-no-op
copy button is unreachable through the real action. Downgraded to minor (D-n9).
