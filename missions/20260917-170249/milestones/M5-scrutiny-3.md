# M5 scrutiny — round 3 (final)

Mission: 20260917-170249
Reviewed commit: ba45d633 `feat(AS-015/016): buildConvertInput utility prepends JS tab as script block`
Reviewer: scrutiny validator (read-only, adversarial)
Date: 2026-09-18

## Verdict

**M5 = GREEN.** No blockers remain for this milestone.

Round-2 blocker **B2 (AS-015/016)** is **cleared**, but *not* for the reason
the fix claims. See "What the code actually does" below — the new utility is
dead code. AS-015/016 are satisfied by the conversion engine itself, which is
independently and adequately tested. Two non-blocking defects are carried
forward into M6.

## Assertion results

| ID | Status | Reason |
|---|---|---|
| AS-015 | PASS | `convert()` merges inline `<style>` blocks into the style model; covered independently of the new utility by `lib/webflow-converter/convert.test.ts:143` (inline-only) and `:154` (css arg + inline combined). Both would fail if the merge were removed. |
| AS-016 | PASS | `convert()` extracts inline `<script>` bodies into `customCode.scripts`; covered independently by `lib/webflow-converter/convert.test.ts:466` and `lib/webflow-converter/js-extract.test.ts:6`. Both would fail if extraction were removed. |

## What the code actually does

`components/webflow-tool/build-convert-input.ts` is a 10-line pure function
that returns `html` unchanged when the JS string is blank, and otherwise
returns `"<script>\n" + js + "\n</script>\n" + html`. That is its entire
behaviour.

**It has zero production callers.** `grep -rn buildConvertInput components app lib`
returns only the definition and its own test file. Nothing in `converter-page.tsx`,
`converter-editor.tsx`, or `converter-preview.tsx` imports it. So the commit did
not "wire" anything; it added an unused helper plus a test that exercises the
helper in isolation.

That is acceptable for M5 only because end-to-end conversion wiring is
explicitly M6 work — `plan.md:155` places `F031 convert-action-wiring
(depends: F022, F023, F029)` in M6, not M5. AS-015/016 as scoped to M5 are
engine-level guarantees, and the engine delivers them. Confirmed separately:
`convertHtmlToWebflow` has **no production caller either** — the editor page
currently has no convert path at all, which is exactly the M6 gap.

## Findings

### D1 — `major` — Two competing, mutually-incompatible JS-injection utilities now exist

`lib/actions/webflow-converter.ts:39` already contains:

```ts
function withInjectedScript(html: string, js?: string): string {
  if (!js || js.trim() === "") return html;
  return `${html}\n<script>\n${js}\n</script>`;
}
```

The new `buildConvertInput` does the same job with the **opposite ordering**
(script *before* the markup rather than after). Whichever one F031 adopts, the
other becomes permanently dead code. Worse: if F031 calls `buildConvertInput(html, js)`
*and* passes `js` through to `convertHtmlToWebflow({ html, css, js })`, the
action will inject the JS a **second** time and `customCode.scripts` will
contain duplicate entries. No test anywhere guards against that double-injection,
because no test crosses both layers. This is a latent M6 correctness bug, filed
now so F031 does not walk into it.

### D2 — `minor` — `test_AS_016_js_tab_content_injected_as_script_block` mirrors its implementation

The test constructs the input string *with the function under test*, then
asserts the output contains `<script>` and the JS body. Any change to
`buildConvertInput` that still emits a syntactically valid script block —
including changing the ordering, adding attributes, or wrapping in a DOMContentLoaded
handler — passes unchanged. The `convert()` round-trip at the end of the test
adds real value, but it is asserting a property of `convert()`, which is already
asserted at `convert.test.ts:466`. Marked `minor`, not FAIL, only because the
assertion's actual intent (inline `<script>` authored directly in the HTML tab)
is covered by that independent engine test.

### D3 — `minor` — Prepending the script before the DOM is semantically wrong

`buildConvertInput` puts the `<script>` *ahead* of the markup. For the GSAP-style
init code the JS tab placeholder explicitly invites ("Paste GSAP or other scripts
here…"), running before the elements exist is the wrong order. It is currently
harmless because `convert()` strips scripts into `customCode` rather than
executing them — but `converter-preview.tsx:24` builds its `srcDoc` with the
script *after* the body, so the two paths disagree about ordering. If F031 ever
reuses `buildConvertInput` for preview, animations will silently fail to bind.
Silent failure, no error path, no test.

## Recommended follow-up features

**FU-1 (assign to M6, before or with F031) — Consolidate JS injection into one
utility.** Delete either `buildConvertInput` or the private `withInjectedScript`
in `lib/actions/webflow-converter.ts` so exactly one function is responsible for
turning JS-tab text into a `<script>` block, and fix its ordering to place the
script after the markup so it matches `converter-preview.tsx`'s `srcDoc`
ordering. The surviving function should live where both the client wiring and
the server action can import it. Add a test that calls the real F031 code path
end to end — editor state in, `ConvertActionResult` out — and asserts
`customCode.scripts` has exactly one entry when the JS tab is non-empty, which
is the test that would have caught the double-injection hazard in D1.

**FU-2 (M6, small) — Assert the AS-016 intent directly at the UI boundary.**
Add a test that seeds the HTML editor with markup containing an inline
`<script>` and *nothing* in the JS tab, runs the convert flow, and asserts the
script body reaches `customCode.scripts`. That is the literal wording of AS-016
("inline `<script>` tags inside the HTML editor's content ... without needing to
be duplicated in the JS tab") and it is currently only proven at the engine
layer, never through the editor. The AS-015 twin (inline `<style>` in the HTML
tab, empty CSS tab) should be added alongside it.

## Gate output

### Typecheck — PASS

`npx tsc --noEmit` — exit 0, no diagnostics.

### Lint — PASS

`npx eslint components/webflow-tool lib/webflow-converter lib/actions` — exit 0,
no output, no warnings.

### Targeted tests — PASS

```
$ npx vitest run components/webflow-tool/
 Test Files  6 passed (6)
      Tests  35 passed (35)
   Duration  1.50s
```

```
$ npx vitest run components/webflow-tool lib/webflow-converter lib/actions/webflow-converter.test.ts
 Test Files  16 passed (16)
      Tests  435 passed (435)
   Duration  1.71s
```

### Full suite — PRE-EXISTING FAILURES, NONE IN MISSION SCOPE

```
$ npx vitest run
 Test Files  252 failed | 495 passed | 1 skipped (748)
      Tests  173 failed | 3606 passed | 1687 skipped (5466)
   Duration  147.43s
```

Failures are integration suites that require live Supabase credentials, e.g.
`tests/integration/workspace-role-expansion.test.ts:177` →
`Failed to create test workspace: ...` in `createWorkspaceWithOwner`. Grepping
the failure output for `webflow` or `converter` returns nothing; every file
under `components/webflow-tool/`, `lib/webflow-converter/`, and
`lib/actions/webflow-converter.test.ts` passes (435/435, above). These failures
are unrelated to M5 and are not counted against this milestone, but they do mean
the repo has no green full-suite baseline — worth flagging to the orchestrator
independently of this mission.
