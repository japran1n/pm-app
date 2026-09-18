# M6 scrutiny report (round 3 — re-scrutiny after F093–F094)

Mission: 20260917-170249
Milestone: M6 (F031–F036) — convert action, results, clipboard, copy buttons, verify box
Date: 2026-09-18
Round-1: `M6-scrutiny-1.md` (RED — 1 blocker, 6 majors)
Round-2: `M6-scrutiny-2.md` (AMBER — 0 blockers, 3 majors: D-M1, D-M2, D-M3)

Verdict: **AMBER — 0 blockers, 5 majors. NOT GREEN.**

The three round-2 majors are addressed as far as they were literally written, and
D-M2/D-M3 are genuinely closed. But **D-M1 was only half-fixed**: F093 implemented the
null-`clipboardData` clause of round-2's FU-G and skipped the clause that mattered most
— "honour `setData`'s boolean return / prove every MIME type is on the clipboard". The
dominant real-world false-success path (WebKit silently dropping `application/json`)
is untouched. Separately, adversarial review surfaced three further majors that
rounds 1 and 2 both missed, two of which I confirmed by mutation testing.

Suite: `npx vitest run components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`
→ 9 files / 89 tests passed. `npx tsc --noEmit` clean. `npm run lint` clean.
**A green suite is not evidence here** — see the mutation matrix below, where four
separate behaviour-destroying edits all keep the suite green.

Blast radius since round 2 is 4 files (2 source, 2 test).

## Round-2 majors — re-verified

### D-M2 — throwing `execCommand` returns `false` — **CLOSED**

`clipboard.ts:33-36` adds `catch { threw = true; result = false }`, and `result` is
initialised `false` at `:29` instead of left unassigned. No exception escapes into the
React click handler from this call. Mutation-verified: removing the `catch` fails
`test_execCommand_throws_returns_false`.

### D-M3 — `</script>` escaping — **CLOSED in code; test is vacuous**

`webflow-converter.ts:41` applies `js.replace(/<\/script>/gi, "<\\/script>")`. Verified
by direct probe against the real action, not by trusting the test:

```
A_plain  alert('</script>MARKER_A')   -> ok=true js=["\nalert('<\\/script>MARKER_A')\n"]
B_space  alert('</script >MARKER_B')  -> ok=true js=["\nalert('</script >MARKER_B')\n"]
C_slash  alert('</script/>MARKER_C')  -> ok=true js=["\nalert('</script/>MARKER_C')\n"]
D_base   alert('MARKER_D')            -> ok=true js=["\nalert('MARKER_D')\n"]
```

Payload survives intact in all four; no split, no breakout. Note the escape is narrower
than the HTML spec (which also terminates on `</script` + whitespace or `/`), and cases
B and C survive only because `node-html-parser` is more lenient than the spec — the
safety rests on the parser, not the escape. Recorded as minor D-m14, since a parser
swap would turn it into an injection.

Its test is vacuous: `webflow-converter.test.ts:81-89` asserts only `ok === true`. I
reverted the escape and re-ran — **8/8 still passed**. Recorded as D-m12.

### D-M1 — null `clipboardData` — **HALF-CLOSED → remains a major (D-M4)**

The null clause is genuinely fixed and pinned. `clipboard.ts:12-15` short-circuits on a
null `e.clipboardData`; `:6` rejects an empty `items` array. Mutation-verified: removing
either guard fails its test. The user-visible path is right — `converter-page.tsx:82`
maps `false` to "Copy failed — try again" (`:154`) and suppresses the `role="status"`
Designer paste instruction (`:165-173`).

**What was not fixed:** `clipboard.ts:42` still returns `result && fired && !threw` —
"execCommand said yes, our handler ran, nothing threw" — which is not "the payload is on
the clipboard". `DataTransfer.setData()` is spec'd to return `void` and to **silently
ignore** data it will not accept; WebKit sanitises non-standard MIME types on the `copy`
event without throwing. So on Safari: handler fires → `setData("application/json", …)`
is a silent no-op → `setData("text/plain", …)` succeeds → `execCommand` returns `true`
→ **`writeToClipboard` returns `true`** → "Copied!" plus the Designer paste instruction
over a clipboard with no `application/json` flavour. That is precisely the false
confirmation AS-034 exists to prevent and the payload delivery AS-031 asserts.

Round-2's FU-G named this explicitly ("honour `setData`'s boolean return where the
browser provides one"; "`true` means every requested MIME type is provably on the
clipboard"). The remedy is available and unused: `e.clipboardData.getData(mime)` or
`Array.from(e.clipboardData.types)` read back inside the same handler. See **D-M4**.

## Assertion verdicts

Per the scrutiny standard — a test that only confirms the implementation rather than
the assertion's intent means the assertion FAILS even when the test passes today.

| ID | Verdict | Sev | Reason |
|---|---|---|---|
| AS-011 | PASS | — | No `.from()`, no RPC, no storage in `webflow-converter.ts`; only `auth.getUser()`. Zero server-only imports in `lib/webflow-converter-client/`. Unenforced by tooling (D-m8). |
| AS-023 | PASS | — | Visible Convert button + ⌘/Ctrl+Enter listener (`converter-page.tsx:94-100`). `ctrlKey` untested (D-m11). |
| AS-024 | PASS | — | `disabled={isEmpty \|\| loading}` + "Paste some HTML first." (`:158-162`). |
| AS-025 | PASS | — | `inFlight` ref guards click and keydown (`:98`); two-keydown test pins it. |
| AS-026 | PASS | — | `TextEncoder().encode(...).length` (`:180`); multi-byte fixture pins the exact KB. |
| AS-027 | PASS | — | Enabled only on `result.ok && errors.length === 0` (`:149`). |
| AS-028 | PASS | — | Native `disabled` with no prior conversion. |
| AS-029 | PASS | — | `role="alert"` render (`converter-results.tsx:43-47`), Copy left disabled. |
| AS-030 | PASS | minor | Note renders unconditionally at `converter-verify.tsx:77-79`, outside any `<details>`. Test not falsifiable (D-m2). |
| **AS-031** | **FAIL** | **major** | **D-M4.** Nothing verifies `application/json` reached the clipboard; silently dropped on WebKit while reporting success. Compounded by **D-M5** (deleting `preventDefault` keeps the suite green — mutation-verified) and by `clipboard.test.ts:41` never asserting the return value on the happy path. |
| **AS-032** | **FAIL** | **major** | **D-M6.** The implementation is correct — synchronous `copy` event, no `navigator.clipboard.write()` anywhere. But no test pins it: `clipboard.test.ts:66-72` asserts the `fired` flag, not the absence of the async API. Adding a `navigator.clipboard.write()` call keeps all 89 tests green. The assertion is unprotected against exactly the regression it names. |
| AS-033 | PASS | — | `role="status"` Designer paste instruction (`:165-173`), gated on success only. |
| **AS-034** | **FAIL** | **major** | Visual `false` → "Copy failed — try again" mapping is correct and the paste instruction is correctly suppressed on failure. It fails via three other routes: the unverified `true` (D-M4); **D-M7** stale success across re-conversion; **D-M8** silent no-op on an `ok` result with empty `json`. |
| AS-035 | PASS | minor | Real `contentEditable` target (`converter-verify.tsx:38`). Attribute still untested (D-m4). |
| AS-036 | PASS | — | Affirmative `PRESENT \| NOT PRESENT`; byte length via `Blob.size` with a multi-byte guard. |
| AS-037 | PASS | minor | Separate button writing only `text/plain` (`converter-results.tsx:35-39`). Consumes the same unverified boolean; weaker failure label (D-m15). |
| AS-038 | PASS | — | `customCode.trim().length > 0` (`converter-results.tsx:33`). |
| AS-106 | PASS | minor | Read-only `<pre>` with the Page Settings label. Inert `<label htmlFor>` (D-m9); echoes the escaped JS (D-m13). |
| AS-119 | PASS | — | Copy gated on `ok && errors.length === 0`; errors rendered even when `ok === true`; no override path exists. |
| AS-120 | PASS | — | All warnings rendered unconditionally in a `max-h-40 overflow-y-auto` container; no cap, no expander. |
| AS-140 | PASS | minor | Both importers are `"use client"`; no server-only imports. But `"use client"` is not a client-only guarantee (the module still executes during SSR) — it survives only because `document` is touched solely inside the handler. Satisfied in fact, unenforced (D-m8). |

No previously-passing assertion regressed. AS-031/032/034 are downgrades relative to
round 2 because this round's review found gaps round 2 missed, not because code changed.

## Defects

### Blockers
None.

### Majors

**D-M4 — major — `writeToClipboard` still returns `true` without proof of delivery.**
`clipboard.ts:42`. See the D-M1 section above. `setData` silently drops rejected MIME
types without throwing, so the WebKit path yields a false "Copied!" plus a paste
instruction over a clipboard missing `application/json`. This is the unfinished half of
round-2's FU-G. Fix: read back `e.clipboardData.getData(mime)` (or check
`e.clipboardData.types`) for every item inside the handler and require all to be
present before returning `true`.

**D-M5 — major — `preventDefault()` is load-bearing and completely unpinned.**
`clipboard.ts:17`. If it is removed, the browser's default copy action overwrites
everything the handler set with the current document selection — a total false success,
since `fired`, `threw` and `result` are all unaffected. Mutation-verified: deleting the
line leaves **10/10 tests green**. The mocks stub `preventDefault: vi.fn()` in four
places and never assert on it.

**D-M6 — major — AS-032 is not pinned by any test.**
`clipboard.test.ts:66-72` is named for AS-032 but asserts the `fired` flag. No test
stubs `navigator.clipboard.write` and asserts `not.toHaveBeenCalled()`. Grep for
`navigator.clipboard` across the client module and the component tests returns nothing.
A regression to the async Clipboard API — the specific thing AS-032 forbids — would
ship green.

**D-M7 — major — stale "Copied!" and stale paste instruction survive a new conversion.**
`converter-page.tsx:60-61`. The success branch calls `setResult(next)` but never resets
`copyStatus`; only the `catch` branch (`:70`) does. Copy successfully → within 3 s edit
the HTML and convert again → the button still reads "Copied!" and the `role="status"`
paste instruction is still on screen, both now referring to a payload that is *not* the
current `result.json`. The user follows the instruction and pastes the previous
conversion. `grep -c "Copied" converter-page.test.tsx` → **0**; nothing covers it.
Round-2 logged this as minor D-m3; it is a false-confirmation under AS-034 and is
promoted to major here.

**D-M8 — major — dead click when an `ok` result carries empty `json`.**
`converter-page.tsx:78` returns early on `!result.json`, but the `disabled` condition at
`:149` checks only `result?.ok` and `errors.length` — not `json`. An `ok` result with
`json: ""` or `undefined` yields an enabled button that on click does nothing: no
"Copied!", no "Copy failed", no log. A silent no-op is exactly what AS-034 forbids.
Fix: include `result.json` in the `disabled` condition, or set `copyStatus: "error"` on
that branch.

### Minors

New this round:

**D-m12 — `test_script_closing_tag_in_js_escaped` is vacuous.** `webflow-converter.test.ts:81-89`
asserts only `ok === true`; reverting the escape keeps it green (verified, 8/8).

**D-m13 — the escape mutates what the user copies back.** The action returns the
*escaped* JS in `result.js`, which flows into AS-106's read-only `<pre>` and AS-037's
"Copy custom code". Harmless in string/template/regex/comment contexts, but
`` String.raw`</script>` `` genuinely changes value, as does any non-JS payload routed
through the JS tab.

**D-m14 — the escape is narrower than the HTML spec.** Only literal `</script>` is
matched; `</script `, `</script/`, `</script\n` also terminate script data per spec and
survive today only because `node-html-parser` is lenient. Prefer `/<\/script/gi`, or
stop round-tripping JS through an HTML string entirely.

**D-m15 — partial write corrupts the clipboard while returning `false`.**
`clipboard.ts:17-25`: `preventDefault()` has already run and earlier `setData` calls have
landed when the loop `break`s, so the user's prior clipboard is destroyed and replaced
with half a payload while the UI says "Copy failed — try again". No test covers it
(`test_setData_throw_returns_false` passes a single item, so the `break` is never
exercised with a surviving sibling).

**D-m16 — bare `catch {}` swallows all conversion diagnostics.** `converter-page.tsx:63-70`
replaces any real failure (network, serialization, auth throw) with a generic message
and no logging.

**D-m17 — `aria-label="Copy for Webflow"` hides the failure text from assistive tech.**
`converter-page.tsx:150`. The `aria-label` overrides the button's text content, so the
accessible name is permanently "Copy for Webflow"; the failure message has no
`role="alert"`/`aria-live`, while the success path does get `role="status"` (`:166`).
The failure notification is strictly weaker than the success one.

**D-m18 — test-global mutation leak.** `clipboard.test.ts:18-21` permanently attaches
`execCommand` to jsdom's `document` (`restoreAllMocks` will not undo a raw property
assignment); `:62` overwrites with `document.execCommand = vi.fn()` rather than `spyOn`.

Carried forward from round 2, all still open, all still minor: **D-m1** dead `seqRef`;
**D-m2** AS-030 not falsifiable; **D-m4** contentEditable untested; **D-m5** success
instruction expires after 3 s; **D-m6** `ConverterResults` copy timer never cleared;
**D-m7** engine dedupes warnings via `new Set`; **D-m8** AS-011/AS-140 unenforced;
**D-m9** inert `<label htmlFor>`; **D-m10** empty `data-testid` div in production markup;
**D-m11** `ctrlKey` untested. (Round-2's D-m3 is promoted to D-M7 above.)

Round-2 follow-up status: **FU-G partially delivered** (null + empty-items clauses done;
the `setData`-verification clause, which was the substantive one, skipped).
**FU-H delivered in code, not in test.** **FU-I and FU-J not attempted.**

## Recommended follow-up features

**FU-L (major — closes D-M4, D-M5, D-M6, D-m15; hardens AS-031, AS-032, AS-034).**
Make `writeToClipboard`'s `true` mean "every requested MIME type is provably on the
clipboard". Inside the `copy` handler, after writing, read each item back with
`e.clipboardData.getData(mimeType)` (or check membership in `e.clipboardData.types`) and
require every one to match before the function may return `true`; a silently-dropped
flavour must yield `false`. Restructure so the clipboard is not mutated until all writes
are validated, so a partial failure cannot destroy the user's existing clipboard while
reporting failure. Wrap the entire function body — including `items.length` and
`document.addEventListener`, both currently outside the `try` — in one `try/catch` that
returns `false`, so nothing can escape into the React click handler. Add tests that
would fail today: a `setData` that silently no-ops for `application/json` while
succeeding for `text/plain` (expects `false`); a two-item payload where the second throws
(expects `false` and no partial commit); an assertion that `e.preventDefault()` was
called, since deleting it currently keeps all 10 tests green; an assertion on the happy
path that the return value is `true`, not merely that the mock map was populated; and a
test stubbing `navigator.clipboard.write` that asserts `not.toHaveBeenCalled()`, so
AS-032 is pinned against the regression it actually names.

**FU-M (major — closes D-M7, D-M8, D-m17; hardens AS-034).** Eliminate the three
remaining false-confirmation routes at the page level. Reset `copyStatus` to `"idle"`
inside the success branch of `handleConvert` (`converter-page.tsx:60-61`), not just the
`catch` branch, so a new conversion cannot inherit the previous one's "Copied!" label or
its Designer paste instruction; add a test that copies, converts again, and asserts both
the label and the `role="status"` paragraph are gone. Include `result.json` in the Copy
button's `disabled` condition (`:149`) so an `ok` result with an empty payload cannot
produce an enabled button whose click is a silent no-op, or set `copyStatus: "error"` on
that branch; test both. Remove the `aria-label` that overrides the button's text content
and give the failure message its own `aria-live`/`role="alert"` region so the failure is
at least as perceivable as the success, and stop auto-clearing the error after 3 s while
leaving the success timeout in place.

**FU-K (minor — closes D-m12, D-m13, D-m14).** Make the `</script>` escape falsifiable,
complete, and non-leaky. Replace the vacuous assertion in
`test_script_closing_tag_in_js_escaped` with one that feeds JS containing a literal
`</script>` inside a string and asserts the returned payload still contains the complete
script body, the marker text after the sequence, and a node count matching the same input
without the sequence — a test that fails when the `replace` at `webflow-converter.ts:41`
is removed. Widen the pattern to `/<\/script/gi` so the escape does not depend on
`node-html-parser` being more lenient than the HTML spec. Stop echoing the escaped form
back to the caller: apply the escape only to the string interpolated into the injected
`<script>` tag and return the user's original JS in `ConvertActionResult.js`, so the
read-only `<pre>` (AS-106) and "Copy custom code" (AS-037) reproduce exactly what the
user typed; pin that with a byte-identity assertion. Better still, pass `js` straight
into `customCode.scripts` and delete the HTML round-trip that forces the escape to exist.

**FU-I (carried forward, minor).** Add a test asserting the Safari note's
`closest("details")` is null (jsdom's `getByText` matches collapsed content, so presence
alone proves nothing), and one asserting the verify target carries
`contenteditable="true"`. Add both at page level too, so deleting `<ConverterVerify />`
from `ConverterPage` falsifies them.

**FU-J (carried forward, minor).** Clear `ConverterResults`' copy-status timer on unmount
and reset its `copyStatus` when `result` changes, to match the page component. Make the
success instruction persist until the next convert or copy rather than expiring on a 3 s
timer, with a fake-timer test pinning survival past 3 s. Either delete the unreachable
`seqRef` sequencing or make it reachable and test it. Replace the inert `<label htmlFor>`
on the `<pre>` with `aria-labelledby` or a heading. Remove the empty
`data-testid="conversion-result"` div. Add a `ctrlKey` variant of the shortcut test. Log
the swallowed exception at `converter-page.tsx:63-70` instead of discarding it. Replace
the raw `document.execCommand` property assignment in `clipboard.test.ts:18-21,62` with
`vi.spyOn` so the mock does not leak across files. Add an ESLint `no-restricted-imports`
rule enforcing that `lib/webflow-converter-client/` never imports server-only code
(AS-011/AS-140).

## Mutation matrix (the reason a green suite is not evidence)

All mutations applied to a clean tree and fully reverted; `git status --porcelain -- lib components`
was empty afterwards.

```
MUT A  remove null-clipboardData guard (clipboard.ts:12-15)
       -> FAIL test_null_clipboardData_returns_false      (1 failed | 9 passed)   GOOD
MUT B  remove execCommand catch (clipboard.ts:33-36)
       -> FAIL test_execCommand_throws_returns_false       (1 failed | 9 passed)   GOOD
MUT C  remove empty-items early return (clipboard.ts:6)
       -> FAIL test_empty_items_returns_false              (1 failed | 9 passed)   GOOD
MUT D  revert </script> escape (webflow-converter.ts:41)
       -> ALL PASS (8 passed)                                                      BAD  (D-m12)
MUT E  delete e.preventDefault() (clipboard.ts:17)
       -> ALL PASS (10 passed)                                                     BAD  (D-M5)
```

Additionally unpinned by inspection (no test references the symbol at all):
```
$ grep -rn "navigator.clipboard" lib/webflow-converter-client/ components/webflow-tool/
NONE                                                                               BAD  (D-M6)
$ grep -c "Copied" components/webflow-tool/converter-page.test.tsx
0                                                                                  BAD  (D-M7)
```

## Full command output

### `npx vitest run components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
  - ESM syntax in a file loaded as CommonJS (tests/realtime-live-delivery-tests.ts:18:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

(node:30511) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30528) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  89 passed (89)
   Start at  01:51:21
   Duration  2.19s (transform 462ms, setup 2.24s, import 532ms, tests 1.48s, environment 2.62s)

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

### Script-escape behavioural probe (temporary test file, deleted after run)

```
A_plain ok=true js=["\nalert('<\\/script>MARKER_A')\n"]
B_space ok=true js=["\nalert('</script >MARKER_B')\n"]
C_slash ok=true js=["\nalert('</script/>MARKER_C')\n"]
D_base  ok=true js=["\nalert('MARKER_D')\n"]
```

### Client-boundary probe (AS-011 / AS-140)

```
$ grep -rE "next/headers|server-only|@supabase/ssr|createClient|'use server'|\"use server\"" lib/webflow-converter-client/
NONE

$ grep -nE "supabase|from\(|createClient" lib/actions/webflow-converter.ts
9:// call made here is auth.getUser(), used purely to gate access; no `.from()`
```
