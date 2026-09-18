# M6 scrutiny report (round 1)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Verdict: **RED — 1 blocker, 6 majors**

Suite state: `npx vitest run components/webflow-tool/ lib/webflow-converter-client/` →
8 files / 63 tests passed. `npx tsc --noEmit` → clean. `npm run lint` (eslint) → clean.
A green suite is not the finding here; the finding is what the suite does not constrain.

## Assertion verdicts

| ID | Verdict | Reason |
|---|---|---|
| AS-023 | PASS | Visible Convert button (`converter-page.tsx:103`) and ⌘/Ctrl+Enter window listener (`:64-73`), both tested. |
| AS-024 | PASS | `disabled={isEmpty \|\| loading}` with trim-based emptiness plus visible "Paste some HTML first." (`:41,107,127`). |
| AS-025 | **FAIL (major)** | Guard `if (… \|\| loading) return` reads `loading` from a render-time closure; two ⌘⏎ keydowns in one tick both pass it. The `disabled` prop protects only the click path. No duplicate-submission test exists. |
| AS-026 | **FAIL (major)** | Size is `result.json.length / 1024` — UTF-16 code units, not bytes; under-reports for any non-ASCII HTML. Test asserts only `getByText(/KB/)`, so it would pass if the figure were 0, NaN, or constant. |
| AS-027 | PASS | Copy enables on `result.ok`; asserted post-success and in both disabled cases. |
| AS-028 | PASS | `disabled={!result?.ok}` (`:118`), native `disabled` attribute, tested with no prior conversion. |
| AS-029 | PASS | Unparseable input returns `payload:null` + errors; rendered `role="alert"` (`converter-results.tsx:47`) with Copy left disabled. Verified directly against the engine. |
| AS-030 | PASS | Chrome/Firefox/Edge-not-Safari note renders unconditionally (`converter-verify.tsx:68-70`), outside any collapsed section. |
| AS-031 | PASS | `application/json` and `text/plain` both set on the copy event (`clipboard.ts:9`, `converter-page.tsx:56-59`). |
| AS-032 | PASS | Synchronous `document.execCommand("copy")` with a `copy` listener; no `navigator.clipboard.write()` anywhere. |
| AS-033 | **FAIL (blocker)** | Not implemented. Success renders the single word "Copied!" on the button (`converter-page.tsx:121`). `grep -rni "designer\|canvas" components/webflow-tool/` returns nothing. The user is never told to click the Webflow Designer canvas and paste. |
| AS-034 | PASS | Failure renders "Copy failed — try again" (`:123-124`), driven by a test forcing `writeToClipboard` false. See Defect D3 for the false-success hole. |
| AS-035 | PASS | Real `contentEditable` paste target reading actual `DataTransfer.types`, with `preventDefault` (`converter-verify.tsx:22-32`). |
| AS-036 | **FAIL (major)** | The absent case has no test. The byte-length test uses `'{"test":1}'`, pure ASCII, so swapping `new Blob([s]).size` for `s.length` passes every test — a textbook mirror-the-implementation test. |
| AS-037 | PASS | Separate button writes `text/plain` with its own `copyStatus` state (`converter-results.tsx:39-43`). |
| AS-038 | **FAIL (major)** | `hasCustomCode = customCode.length > 0` on a raw `join("\n\n")`. `js: ["   "]` or `js: ["",""]` renders the panel and enables the button over empty content. No `.trim()`, no test. |
| AS-106 | PASS | `<pre>` (non-editable) with the "Page Settings → Before `</body>`" label; the test also asserts no `textbox` role exists, which is the right anti-regression. |
| AS-118 | PASS | Verified at the engine: `convert.ts:113-129` returns `payload:null` with errors, or a payload with `errors: []`. Exercised live: `'<<<>>> <div'` → errors=1, payload=null; `'<div class="a">'` → errors=0, payload present. |
| AS-119 | PASS (fragile) | Both copy paths gate on `ok`, native `disabled`, and `handleCopyWebflow` re-guards at `:55`. No override control exists. Fragile: see D6. |
| AS-120 | **FAIL (major)** | Warnings are hard-capped at 3 behind a "Show N more" expander (`converter-results.tsx:19,31-34,66-74`) that **no test exercises** — every warnings test uses ≤2. Warnings 4..n can silently vanish with a green suite. `showAllWarnings` is also never reset when `result` changes. |
| AS-011 | PASS | `lib/webflow-converter-client/` has zero hits for `next/headers`, `server-only`, `@supabase/ssr`, `createClient`, `lib/supabase/server`, `'use server'`. Its only two importers (`converter-page.tsx:21`, `converter-results.tsx:13`) are both `"use client"`. The action makes no `.from()` call. |

## Defects

**D1 — blocker — AS-033 paste instruction absent.** `converter-page.tsx:121-125`. Nothing anywhere in
`components/webflow-tool/` mentions the Designer or the canvas. The assertion is simply unimplemented.

**D2 — major — stale `copy` listener hijacks the user's next Cmd+C.** `clipboard.ts:12-15` removes the
listener only when `execCommand` returns `false`; `{once:true}` removes it only if the event actually
fires. When `execCommand` returns `true` without dispatching (WebKit has done this with no selection),
the handler stays live on `document` and will `preventDefault()` the user's next manual copy anywhere
on the page and overwrite it with the stale Webflow payload.

**D3 — major — success reported when the copy never happened.** Same lines. The return value is
`execCommand`'s, which is not evidence that `setData` ran. Additionally `setData` at `clipboard.ts:9` is
unguarded: a browser rejecting `application/json` throws inside the listener, the loop aborts leaving
`text/plain` unwritten too, `execCommand` still returns `true`, and the UI says "Copied!". This is
precisely the false confirmation AS-034 exists to prevent. Fix: a `fired` flag set inside the handler,
try/catch around `setData`, `removeEventListener` in a `finally`, and `return success && fired`.

**D4 — major — a thrown Server Action shows the user nothing.** `converter-page.tsx:43-52` has
`try/finally` with no `catch`. Next.js Server Actions reject on network failure, serialization failure,
or deploy-digest mismatch, and `convert()` is called unguarded at `webflow-converter.ts:64`. On
rejection `setResult` never runs, `result` retains its previous value — possibly a stale *successful*
one, leaving "Copy for Webflow" enabled over an obsolete payload — and the button just flips back to
"Convert" with zero feedback.

**D5 — major — stale response can clobber newer state.** No request sequencing in `handleConvert`.
Combined with D-AS-025 (the keyboard path defeating the in-flight guard), an older conversion can
resolve last and win, leaving Copy pointed at a payload that does not match the editor.

**D6 — major — AS-119 holds only by engine invariant, with no defence in depth.** The UI gates copy on
`result.ok` alone, never on `errors.length === 0`, and `ConverterResults` never renders `errors` when
`ok === true`. Today `convert()` guarantees errors ⟺ null payload (`convert.ts:113-129`), so this is
correct — but the day any path returns a payload alongside errors, the copy button is live and the
errors are invisible. Passing today; one refactor from a silent AS-119 violation.

**D7 — minor — copy-status timers unguarded.** `converter-page.tsx:61`, `converter-results.tsx:42`:
`setTimeout` never cleared on unmount or re-click; a second copy inside 3s has its status cleared early.

**D8 — minor — custom-code copy failure is silent.** `converter-results.tsx:41` sets `copyStatus`
to `"error"`, but the button label at `:97` only distinguishes `"success"`. A failed custom-code copy
is indistinguishable from never having clicked.

**D9 — minor — `aria-label="Convert"` overrides the visible "Converting…".** `converter-page.tsx:109`.
No `aria-busy`/`aria-live`, so AS-025's in-flight feedback is visual-only for assistive tech.

**D10 — minor — assertion IDs in test names are swapped.** `converter-results.test.tsx:85,103` are
named AS-037 but test AS-038's visibility rule; `:152` is named AS-038 but tests AS-037's copy;
`clipboard.test.ts:47` is named AS-032 but tests a MIME write. Traceability reports built from these
names are misleading.

**D11 — minor — no comment records why `execCommand` is used.** `clipboard.ts:13` is deprecated API
chosen deliberately (it is the only way to set `application/json`). Without a rationale comment a
future "modernize to navigator.clipboard" silently breaks AS-031/AS-032.

**D12 — minor — AS-030/AS-035 not asserted at page level.** `converter-page.test.tsx` never references
`ConverterVerify` or "Safari"; deleting `<ConverterVerify />` at `converter-page.tsx:148` falsifies both
assertions while the suite stays green.

## Recommended follow-up features

**FU-A (blocker, closes AS-033).** After a successful "Copy for Webflow" write, the page must render a
persistent confirmation region — not just a transient button label — containing explicit next-step
instructions naming the Webflow Designer canvas: open the Webflow Designer, click on the canvas to
focus it, and press Cmd/Ctrl+V. The message must be announced to assistive tech (`role="status"`), must
not appear when the copy failed, and must be covered by a test that asserts the presence of the
instruction text (matching on "Designer" and "paste"), not merely on the word "Copied".

**FU-B (major, hardens AS-031/AS-032/AS-034).** Rewrite `writeToClipboard` so its boolean return means
"the payload is provably on the clipboard": set a `fired` flag inside the copy handler, wrap each
`setData` in try/catch and treat any throw as total failure, always `removeEventListener` in a `finally`
so no listener can survive and hijack a later user copy, and return `success && fired && !threw`. Add
tests for three previously uncovered paths — `execCommand` returning `true` without dispatching the
event, `setData` throwing on the `application/json` type, and verification that the listener is removed
with the same handler reference in every outcome.

**FU-C (major, closes AS-025 and D4/D5).** Make the convert flow concurrency-safe and failure-visible:
replace the closure-captured `loading` guard with a `useRef` in-flight flag so a rapid double ⌘⏎ cannot
issue two requests, add a monotonically increasing request-sequence token so a late-resolving older
response is discarded rather than applied, and add a `catch` that converts a rejected Server Action into
a visible `ok:false` result with a clear message while clearing any stale successful payload so
"Copy for Webflow" cannot remain enabled over obsolete data. Cover each with a test: double-shortcut
fires one request; out-of-order resolution keeps the newer result; a rejecting action shows an error.

**FU-D (major, closes AS-026 and AS-036).** Compute payload size in real bytes via
`new TextEncoder().encode(json).length`, display bytes for small payloads rather than rounding to
"0 KB", and assert the exact numeric figure in a test using a multibyte fixture (e.g. an em-dash or
emoji) whose UTF-8 byte count differs from its `.length`. Apply the same multibyte fixture to the verify
box's byte-length test so the `new Blob([...]).size` implementation is actually pinned.

**FU-E (major, closes AS-036 absent-case and AS-120).** Make the verify box report `application/json`
presence affirmatively — a distinct "application/json: present / NOT PRESENT" line rather than leaving
the user to scan a list — and test the absent case (paste with only `text/plain`) alongside the present
case. Separately, remove or test the three-warning cap in `ConverterResults`: either render all warnings
with a scroll container, or keep the expander but reset `showAllWarnings` whenever `result` changes and
add a test with five warnings asserting every one is reachable. No warning may be unreachable in any
state.

**FU-F (minor, hardens AS-119 and cleans up).** Gate both copy paths on `result.ok && (result.errors
?.length ?? 0) === 0` rather than `ok` alone, and render `errors` in `ConverterResults` whenever present
regardless of `ok`, so a future engine change cannot silently produce a copyable payload with errors.
Also: clear copy-status timers on unmount, render the custom-code copy failure state, trim custom code
before the non-empty check (AS-038), drop the `aria-label="Convert"` override in favour of `aria-busy`,
add a rationale comment above `document.execCommand`, add a page-level test asserting `ConverterVerify`
and the Safari note mount, and correct the swapped AS-037/AS-038/AS-032 test names.

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:17077) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(node:17086) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.

 Test Files  8 passed (8)
      Tests  63 passed (63)
   Start at  01:28:36
   Duration  2.18s (transform 405ms, setup 2.19s, import 499ms, tests 1.27s, environment 2.56s)

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

### Direct engine probe (AS-118 verification, run via tsx)

```
<<<>>> <div          -> errors= 1 payload= null
<div class="a">      -> errors= 0 payload= obj
<div><div><div><div> -> errors= 0 payload= obj
```
