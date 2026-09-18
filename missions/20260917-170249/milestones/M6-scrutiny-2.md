# M6 scrutiny report (round 2 — re-scrutiny after F088–F092)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Round-1 report: `missions/20260917-170249/milestones/M6-scrutiny-1.md` (RED — 1 blocker, 6 majors)

Verdict: **AMBER — 0 blockers, 3 new majors. Every round-1 failure is closed; every
assertion passes. Not declared GREEN because three new majors surfaced.**

Suite state: `npx vitest run components/webflow-tool/ lib/webflow-converter-client/` →
8 files / 78 tests passed (was 63). `npx tsc --noEmit` clean. `npm run lint` clean.

## Round-1 failures — re-verified

| ID | R1 | R2 | What the code now does |
|---|---|---|---|
| AS-025 | FAIL (major) | **PASS** | `inFlight` ref (`converter-page.tsx:46,54,98`) guards both the click and keydown paths, so the stale-`loading`-closure hole is gone. `converter-page.test.tsx:341-361` fires two ⌘⏎ keydowns in one tick and asserts exactly one call — this fails if the ref guard is removed. A rejected Server Action now sets a visible `ok:false` result (`:62-70`) and the test at `:363-377` asserts both the message and that Copy stays disabled. |
| AS-026 | FAIL (major) | **PASS** | `new TextEncoder().encode(result.json).length` (`converter-page.tsx:180`). The test fixture is 400 × "€" — 1200 UTF-8 bytes vs 402 UTF-16 units — and asserts the exact KB figure (`converter-page.test.tsx:121-143`). Reverting to `.length` fails it. |
| AS-033 | FAIL (blocker) | **PASS** | `converter-page.tsx:165-173` renders a `role="status"` paragraph on `copyStatus === "success"`: "Open the Webflow Designer, click on the canvas to focus it, then press Cmd/Ctrl+V to paste." Tested on `/designer/i` **and** `/paste/i` (`:294-314`), and asserted absent both before any copy and after a failed copy (`:316-339`). The blocker is closed. |
| AS-036 | FAIL (major) | **PASS** | `converter-verify.tsx:58-65` renders an affirmative `application/json: PRESENT | NOT PRESENT` line. Both cases tested (`converter-verify.test.tsx:67-83`). Byte length uses a 🎉 fixture with an explicit `expect(expectedBytes).not.toBe(json.length)` guard (`:48-65`), so swapping `Blob.size` for `.length` fails. |
| AS-038 | FAIL (major) | **PASS** | `customCode.trim().length > 0` (`converter-results.tsx:33`). `js: ["   ", "\n"]` now renders no panel and no button (`converter-results.test.tsx:184-200`). `["",""]` → `"\n\n"` → trims empty, also correct. |
| AS-119 | PASS (fragile) | **PASS** | Copy is now gated on `result.ok && (result.errors?.length ?? 0) === 0` (`converter-page.tsx:149`), not `ok` alone, and `ConverterResults` renders errors even when `ok === true` (`converter-results.tsx:49-53`). Both tested (`converter-page.test.tsx:183-199`, `converter-results.test.tsx:101-113`). D6's defence-in-depth gap is closed. |
| AS-120 | FAIL (major) | **PASS** | The three-warning cap and the "Show N more" expander are gone; all warnings map unconditionally into a `max-h-40 overflow-y-auto` scroll container (`converter-results.tsx:63-67`). The test uses five warnings, asserts each is in the document, and asserts no "show N more" button exists (`converter-results.test.tsx:83-99`). |

## Regression spot-checks

| ID | Verdict | Reason |
|---|---|---|
| AS-023 | PASS | Visible Convert button (`converter-page.tsx:134-144`) + ⌘/Ctrl+Enter listener (`:94-104`). Tested at `converter-page.test.tsx:77`, `:171`. Only the `metaKey` branch is exercised; `ctrlKey` is untested (minor). |
| AS-024 | PASS | `disabled={isEmpty \|\| loading}` with trim-based emptiness, plus visible "Paste some HTML first." (`:138,158-162`), both asserted. |
| AS-027 | PASS | Enabled only after a successful, error-free conversion; asserted post-success and in both disabled cases. |
| AS-028 | PASS | Native `disabled` with no prior conversion (`converter-page.test.tsx:208-213`). |
| AS-029 | PASS | `role="alert"` error render (`converter-results.tsx:43-47`) with Copy left disabled (`converter-page.test.tsx:215-227`). |
| AS-030 | PASS (weak test) | The note renders unconditionally at `converter-verify.tsx:77-79`. See D-M3 — the test would not catch it being moved into a collapsed section. |
| AS-031 | PASS | Both `application/json` and `text/plain` written (`converter-page.tsx:79-82`), asserted as an exact payload (`converter-page.test.tsx:246-249`) plus a unit-level multi-MIME test (`clipboard.test.ts:52-59`). |
| AS-032 | PASS | Synchronous `copy` listener + `document.execCommand` (`clipboard.ts:21-31`); no `navigator.clipboard.write()` anywhere. `clipboard.test.ts:67-73` stubs `execCommand` to return `true` without dispatching and expects `false` — an async-API implementation cannot pass this. |
| AS-034 | PASS (see D-M1) | "Copy failed — try again" (`converter-page.tsx:152-156`), tested at `:272-292`. Round-1's D2/D3 are genuinely closed: `fired`/`threw` flags and `finally`-based `removeEventListener` (`clipboard.ts:6-33`), with tests for the no-fire path, the `setData`-throws path, and listener removal with the same handler reference in all three outcomes (`clipboard.test.ts:67-134`). Two residual false-success paths remain — D-M1. |
| AS-035 | PASS (weak test) | Real `contentEditable` target reading `event.nativeEvent.clipboardData.types` with `preventDefault` (`converter-verify.tsx:22-32,37-44`). No test asserts the `contenteditable` attribute — see D-m4. |
| AS-037 | PASS | Separate button writing only `text/plain` (`converter-results.tsx:35-39,85-95`); test asserts the exact single-entry payload (`converter-results.test.tsx:202-219`). |
| AS-106 | PASS | `<pre>` with the "Page Settings → Before `</body>`" label; the test asserts the `<pre>` exists **and** no `textbox` role does (`converter-results.test.tsx:150-182`). |
| AS-011 | PASS (unenforced) | `lib/webflow-converter-client/` = a 1-line `index.ts` re-export + `clipboard.ts` (`"use client"`, `document.execCommand` only). Grep for `next/headers`, `server-only`, `@supabase/ssr`, `createClient`, `'use server'` → zero hits. Its only two importers, `converter-page.tsx:21` and `converter-results.tsx:13`, are both `"use client"`. |
| AS-140 | PASS (unenforced) | Same evidence. Nothing automated guards either assertion — see D-m8. |

No regressions found in any previously-passing assertion.

## Defects

### Majors (new)

**D-M1 — major — `writeToClipboard` can still return `true` having written nothing.**
`lib/webflow-converter-client/clipboard.ts:14` uses `e.clipboardData?.setData(...)`. If `clipboardData`
is `null` — real in some embedded and permission-restricted contexts — every write silently no-ops,
`fired` is `true`, `threw` is `false`, and `:33` returns `true`. The UI then shows "Copied!" *and* the
Designer paste instruction over an empty clipboard: exactly the false confirmation AS-034 exists to
prevent. The same line-33 logic returns `true` for an empty `items` array. Additionally
`DataTransfer.setData` can fail without throwing, and its boolean return is discarded. No test covers a
null `clipboardData`. Fix shape: count successful `setData` calls and require `wrote === items.length`.

**D-M2 — major — a throwing `execCommand` escapes the React event handler.**
`clipboard.ts:24-31` is `try/finally` with no `catch`, and `result` is left unassigned on a throw.
`execCommand` does throw in some sandboxed-iframe contexts. `handleCopyWebflow`
(`converter-page.tsx:77-86`) does not wrap the call, so the exception propagates: `setCopyStatus("error")`
never runs, no failure message appears, and the button sits on "Copy for Webflow" as though nothing
happened. Untested. Fix: `catch { result = false }`.

**D-M3 — major — `</script>` in user JS corrupts the payload.**
`lib/actions/webflow-converter.ts:41` interpolates the JS-tab content into a raw
`` `<script>${js}</script>` ``. Any `</script>` inside the user's JS — in a string literal, a regex, a
template — terminates the tag early, corrupting the HTML parse and silently splitting the payload. This
is reachable with ordinary user input and has no test. Not assigned to an M6 assertion, which is why it
is not a blocker, but it is a correctness bug in M6-touched code.

### Minors

**D-m1 — AS-025's stale-response guard is dead code.** `converter-page.tsx:48,56,60,63`. Because
`inFlight` serializes conversions, a second request can never start while the first is pending, so
`seqRef` can never mismatch. The out-of-order clause is satisfied structurally but is neither exercised
nor exercisable. If `inFlight` is ever loosened to allow cancel-and-resubmit, the untested seq path
becomes the only protection.

**D-m2 — AS-030's "always visible" clause is not falsifiable by any test.** The only test
(`converter-verify.test.tsx:31`) is a `getByText` on the isolated component, and `getByText` matches
inside a collapsed `<details>` in jsdom. Moving the note into a collapsed section would keep the suite
green.

**D-m3 — copy status is not reset when `result` changes.** `converter-page.tsx:35` and
`converter-results.tsx:22`. Convert → Copy → Convert again leaves a stale "Copied!" label — and, on the
page, a stale Designer paste instruction — attached to a *new* payload for up to 3 s.

**D-m4 — no test asserts the verify box is `contentEditable`.** `converter-verify.test.tsx:23-29` only
checks the element exists. Swapping the div for a non-editable one keeps the suite green while making
the box unusable, since a non-editable div receives no paste event. AS-035 would be silently violated.

**D-m5 — the success instruction self-destructs after 3 s.** `converter-page.tsx:84-85` resets
`copyStatus` to `"idle"`, unmounting the `role="status"` paragraph at `:165`. It tells the user to switch
applications, then vanishes. The test reads it immediately and never advances timers, so a shortened
timeout would not be caught.

**D-m6 — `ConverterResults`' copy timer is never cleared.** `converter-results.tsx:38`. Unmount inside
the 3 s window produces a post-unmount state update; rapid clicks stack timers. The page component
clears its equivalent (`converter-page.tsx:84-92`) — the two are inconsistent.

**D-m7 — engine dedupes warnings.** `lib/webflow-converter/convert.ts:74,118,127` build warnings through
`new Set(...)`, so two byte-identical warnings collapse into one. Defensible, but it is technically a
silent drop under AS-120 and nothing tests it.

**D-m8 — AS-011/AS-140 hold by inspection only.** No lint rule and no static test guards the client-only
boundary; a future server-only import into `lib/webflow-converter-client/` would go undetected.

**D-m9 — `<label htmlFor>` pointing at a `<pre>`.** `converter-results.tsx:73-84`. `<pre>` is not a
labelable element, so the association is inert; AS-106 holds only because the text is visually adjacent.

**D-m10 — test scaffolding shipped in production markup.** `converter-page.tsx:189-191` renders an empty
`data-testid="conversion-result"` div that no test references.

**D-m11 — `ctrlKey` branch of the shortcut is untested.** `converter-page.tsx:96`; only `metaKey` is
exercised. AS-023 names both.

## Recommended follow-up features

**FU-G (major, hardens AS-034).** Make `writeToClipboard`'s `true` mean "every requested MIME type is
provably on the clipboard". Replace the `fired` flag with a count of successful `setData` calls and
require it to equal `items.length`; treat a null `e.clipboardData` and an empty `items` array as failure;
honour `setData`'s boolean return where the browser provides one; and wrap `document.execCommand` in a
`catch` that yields `false` rather than letting the exception escape the React click handler. Add tests
for a null `clipboardData` (expects `false`), an empty items array (expects `false`), and a throwing
`execCommand` (expects `false`, not a thrown error) — and a page-level test asserting that each of those
produces the "Copy failed — try again" label and no Designer paste instruction.

**FU-H (major, correctness of the convert action).** Escape the user's JS before interpolating it into
the injected `<script>` tag in `lib/actions/webflow-converter.ts`, so a `</script>` sequence inside a
string literal, regex, or template cannot terminate the tag early and split the payload. Prefer building
the script node programmatically or replacing `</script` with `<\/script` before interpolation. Cover it
with a test whose JS input contains a literal `</script>` inside a string and which asserts the converted
payload still contains the full script body and the correct node count.

**FU-I (major, hardens AS-030/AS-035 test falsifiability).** The browser-support note and the
contentEditable paste target are both correct in the code but neither is pinned by a test that would
fail if the behaviour broke. Add a test asserting the Safari note is rendered outside any `<details>` or
otherwise-collapsed ancestor (walk `closest("details")` and assert null, since jsdom's `getByText` matches
collapsed content), and a test asserting the verify target carries `contenteditable="true"`. Add both at
page level as well, so deleting `<ConverterVerify />` from `ConverterPage` falsifies them.

**FU-J (minor, polish and consistency).** Reset `copyStatus` to `"idle"` whenever `result` changes, in
both `ConverterPage` and `ConverterResults`, so a stale "Copied!" and a stale Designer instruction cannot
attach to a fresh payload. Make the success instruction persist until the next convert or copy rather
than expiring on a 3 s timer, and add a fake-timer test pinning that it survives past 3 s. Clear
`ConverterResults`' copy-status timer on unmount to match the page component. Either delete the
now-unreachable `seqRef` sequencing or add a test that makes it reachable. Replace the inert
`<label htmlFor>` on the `<pre>` with an `aria-labelledby` or a plain heading. Remove the empty
`data-testid="conversion-result"` div from production markup. Add a `ctrlKey` variant of the keyboard
shortcut test. Add a static guard — an ESLint `no-restricted-imports` rule or a test that greps the
module — enforcing that `lib/webflow-converter-client/` never imports server-only code (AS-011/AS-140).

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:27078) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27089) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  8 passed (8)
      Tests  78 passed (78)
   Start at  01:42:31
   Duration  2.24s (transform 457ms, setup 2.27s, import 482ms, tests 1.45s, environment 2.60s)

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

### Client-boundary probe (AS-011 / AS-140)

```
$ grep -rE "next/headers|server-only|@supabase/ssr|createClient|'use server'|\"use server\"" lib/webflow-converter-client/
NONE

$ grep -rn "webflow-converter-client" app components lib --include="*.ts" --include="*.tsx"
components/webflow-tool/converter-results.tsx:13:import { writeToClipboard } from "@/lib/webflow-converter-client/clipboard"
components/webflow-tool/converter-results.test.tsx:15:import { writeToClipboard } from "../../lib/webflow-converter-client/clipboard"
components/webflow-tool/converter-results.test.tsx:17:vi.mock("../../lib/webflow-converter-client/clipboard")
components/webflow-tool/converter-page.test.tsx:17:vi.mock("../../lib/webflow-converter-client/clipboard", () => ({
components/webflow-tool/converter-page.tsx:21:import { writeToClipboard } from "@/lib/webflow-converter-client/clipboard"
```
