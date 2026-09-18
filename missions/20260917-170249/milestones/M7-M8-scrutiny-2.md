# M7+M8 Scrutiny — Round 2

Read-only adversarial re-review. No code, test, or contract was modified.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-126 | PASS | — | `eslint.config.mjs` applies `jsxA11y.configs.recommended.rules` to `**/*.tsx,**/*.jsx` globally; disables are scoped to an explicit 36-file out-of-scope list; `npm run lint` exits clean with zero output. No suppression touches `components/webflow-tool/*`. |
| AS-121 | PASS | — | `bg-blue-500` is gone from `converter-editor.tsx`; the dot indicator is `bg-primary` (semantic token, correct for an "active/has-content" accent). No hardcoded hex/named colors remain in `components/webflow-tool/*.tsx`. |
| AS-122 | PASS | — | `converter-preview.tsx:47` iframe is `bg-background`, not `bg-white`. Theme-reactive in both themes. |
| AS-123 | PASS (with gap, see AS-123b) | minor | `converter-verify.tsx:43` pairs `focus:outline-none` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` — visible ring restored. `converter-results.tsx:67` warnings `<ul>` has `tabIndex={0}` with a justified eslint-disable. |
| AS-123b (residual) | FAIL | minor | `converter-results.tsx:87` — the custom-code `<pre>` is a scroll container (`max-h-64 overflow-x-auto overflow-y-auto`) but has **no** `tabIndex={0}`. Keyboard-only users cannot scroll it. Same defect class that was fixed on the `<ul>` two elements above; the fix was applied inconsistently. |
| AS-128 | PASS | — | Warnings `<ul>` carries `overflow-x-auto` + `break-words`, and each `<li>` repeats `break-words`. A long unbroken warning token wraps rather than blowing out the card. |
| AS-132 | FAIL | blocker | Implementation is correct — `validator.ts:152-162` routes names matching `TAILWIND_VARIANT_RE` to `warnings` instead of `errors`, so `md:w-1/2`, `w-[32px]`, `dark:hover:bg-red-500` warn and the payload stays non-null, while `1-bad-class` still errors. **But there is zero test coverage.** `grep -rn "AS-132" lib components app` returns only source comments in `validator.ts`; no test anywhere feeds a colon- or bracket-containing class name through `validatePayload` or `convert`. Deleting the `TAILWIND_VARIANT_RE` branch entirely would leave all 473 tests green. Per the "a test that would fail if the behaviour broke" standard, this assertion is unverified. |
| AS-011 | FAIL | major | The guard now walks real directories (`components/webflow-tool/`, `lib/webflow-converter-client/`) plus the explicit `lib/actions/webflow-converter.ts`, filters by directory not filename, and has a `expect(webflowFiles.length).toBeGreaterThan(0)` guard-the-guard. Good. **However the assertion it makes on those files was weakened**: the `lib/webflow-converter/` loop asserts `not.toContain("supabase")`, but the extended walk only asserts `not.toContain("from '@supabase/")` / `from "@supabase/"`. A file doing `import { createClient } from "@/lib/supabase/client"` — the repo's own idiomatic import path — passes this guard silently. That is the most likely way Supabase would actually creep in. |
| AS-133 (keyboard) | PASS | — | `converter-page.test.tsx` has real forward-Tab-order tests (`userEvent.tab()` from the HTML editor through Convert to Copy, plus a CSS-tab variant confirming position is preserved across tab switches) and a `user.keyboard("{Control>}{Enter}{/Control}")` shortcut test driven from focus inside the editor, complementing the existing `fireEvent.keyDown(window, {metaKey:true})` coverage. These exercise behaviour, not implementation. |
| AS-134 (GSAP) | PASS | — | `js-extract.test.ts:112-143` asserts the GSAP CDN URL never appears in `JSON.stringify` of the clipboard payload, and positively asserts it *does* land in `customCode.scripts` and in `warnings`. Both directions pinned — a regression that either leaks it into the payload or silently drops it would fail. |

## New issues introduced by the round-1 fixes

1. **jsx-a11y override scope — no global suppression risk (clear).** The disable block is keyed to a literal 36-entry `files` list; the recommended ruleset itself is applied to all TSX. Verified by inspection. One latent maintenance hazard: that list is a snapshot. A future accessibility feature that fixes those files will leave dead overrides behind with no test to detect it, and any *new* file added to the list would silently opt out of a11y linting with no review signal. Recommend a follow-up feature to burn the list down.
2. **`bg-primary` on the tab dot indicator — semantically correct.** It marks "this tab has content," an affirmative/active state; `--primary` is the right token. It is `aria-hidden="true"` and the state is redundantly exposed via `aria-label="HTML (has content)"`, so it is not a color-only signal. No issue.
3. **Inconsistent tabIndex application** — see AS-123b above.
4. **Assertion-weakening during a fix** — see AS-011 above. Worth flagging as a pattern: the round-1 fix made the *walker* stronger while making the *assertion* weaker, netting close to zero. A reviewer skimming the diff would read this as a strict improvement.

## Tooling results

- `npm run lint` — clean, zero output, exit 0.
- `npx tsc --noEmit` — clean, zero output, exit 0.
- `npx vitest run components/webflow-tool/ lib/webflow-converter/` — 16 files, 473 tests, 473 passed, 0 failed (2.30s).

## Recommended follow-up features

**F-A (blocker, closes AS-132).** Add Tailwind-variant validator coverage to `lib/webflow-converter/validator.test.ts` and an end-to-end case in `convert.test.ts`. The unit cases must assert, for each of `md:w-1/2`, `w-[32px]`, `dark:hover:bg-red-500`, and `hover:text-blue-500`, that `validatePayload` returns `valid: true`, pushes exactly one entry into `warnings` naming the offending class, and pushes nothing into `errors`. A negative case must assert `1-bad-class` still produces an `errors` entry and `valid: false`, so the regex cannot be loosened into a no-op. The end-to-end case must run source HTML/CSS containing a variant class through `convert()` and through the `convertHtmlToWebflow` server action, and assert the returned result's `payload` is not `null` and its `json` parses — this is the literal wording of AS-132 and is currently untested at the boundary where it matters.

**F-B (major, closes AS-011).** Strengthen the Supabase-import guard in `convert.test.ts` so the extended walk asserts the same strictness as the `lib/webflow-converter/` loop: the file contents, lowercased, must not contain the substring `supabase` at all — covering `@/lib/supabase/...` path imports, `createServerClient`-adjacent helpers, and dynamic `import("...supabase...")` alike. If an allowlist is genuinely needed (e.g. a comment mentioning the word), it should be an explicit per-file exception with a written justification rather than a narrowed match pattern. Add a self-test that a synthetic fixture string containing `from "@/lib/supabase/client"` would be caught.

**F-C (minor, closes AS-123b).** Give the custom-code `<pre>` in `converter-results.tsx` the same keyboard treatment already applied to the warnings `<ul>`: `tabIndex={0}`, a visible `focus-visible` ring, and an accessible name (it already has `aria-labelledby`). Add a test that queries every element in the rendered converter results carrying an `overflow-y-auto` or `overflow-x-auto` class and asserts each has `tabIndex === 0` — a structural test so the next scroll container added cannot regress this.

**F-D (minor, hygiene).** Burn down the 36-file `jsx-a11y` disable list in `eslint.config.mjs`. Fix the underlying violations file by file and delete each entry; add a lint-config test asserting the override block's `files` array is empty (or below a ratcheting threshold) so the list can only shrink.

## Overall verdict

**RED** — AS-132 (blocker: correct implementation, zero test coverage; the behaviour could be deleted without failing a single test) and AS-011 (major: guard assertion weakened to a pattern that misses the repo's own idiomatic Supabase import path). AS-126, AS-121, AS-122, AS-128 and the new keyboard/GSAP coverage genuinely landed and are solid.
