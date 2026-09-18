# M7+M8 — Scrutiny round 3 (re-verification of round-2 failures)

Verdict: **GREEN** (with 3 minor, non-blocking follow-ups)

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-132 | PASS | `validator.ts:152-164` routes non-Webflow-legal names matching `TAILWIND_VARIANT_RE` to `warnings` and keeps the style as a stub; 4 tests at `convert.test.ts:498-567` cover `md:w-1/2`, `w-[32px]`, `hover:text-blue-500` (warning + `errors == []` + non-null payload) and `123invalid` (hard error). Falsifiable: `CLASS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/` rejects `:`, `[`, `/`, so deleting the variant branch makes all three `expect(result.errors).toEqual([])` assertions fail. Independently probed: payload retains style name `"md:w-1/2"` — behaviour matches the contract's "treated as plain class names". |
| AS-011 | PASS | Guard at `convert.test.ts:392-459` scans `lib/webflow-converter/*.ts` (full-text `not.toContain("supabase")`), plus recursive walks of `components/webflow-tool/`, `lib/webflow-converter-client/`, and `lib/actions/webflow-converter.ts` with `/from\s+['"][^'"]*supabase[^'"]*['"]/` on lowercased contents. Verified the regex matches both `@supabase/supabase-js` and `@/lib/supabase/client`. Guard-the-guard (`webflowFiles.length > 0`) prevents a silent empty-scan pass. Grep confirms zero Supabase references in those trees today. |
| AS-123 (residual) | PASS | `components/webflow-tool/converter-results.tsx:87-94` — custom-code `<pre>` now has `tabIndex={0}` plus `aria-labelledby="converter-custom-code-label"`; the eslint suppression is scoped to that one line. Swept `components/webflow-tool/` for `overflow-*-auto`: only two scroll regions exist (the warnings `<ul>` at line 67 and this `<pre>`), both focusable. |

## New issues introduced

None. `npx tsc --noEmit` clean, `eslint` clean, scoped suite 477/477 green.

## Residual weaknesses (minor — do not block the milestone)

**minor — AS-011 guard evasion paths.** The regex only matches `from '<path>'`. A bare side-effect import (`import "@/lib/supabase/client"`), a dynamic `await import("...")`, or `require("...")` in `components/webflow-tool/` or `lib/actions/webflow-converter.ts` would pass the guard. Verified empirically: the first two forms return `false` against the regex. Follow-up spec: broaden the AS-011 guard so that, for every scanned file outside `lib/webflow-converter/`, it also rejects `import\s+['"][^'"]*supabase`, `import\(\s*['"][^'"]*supabase`, and `require\(\s*['"][^'"]*supabase`. A single combined regex over any quoted specifier containing `supabase` that is preceded by `from`, `import`, or `require` is sufficient; keep the existing `webflowFiles.length > 0` guard-the-guard.

**minor — AS-132 hard-error path is only proven below `convert()`.** The malformed-name test constructs a mutated payload and calls `validatePayload` directly. The end-to-end path (bad CSS in → error out of `convert()`) is untested, so a future change in `convert()` that swallowed validator errors before returning would not be caught by this test. Follow-up spec: add one `convert()`-level test whose CSS defines a class name that is neither Webflow-legal nor Tailwind-variant-shaped (e.g. one containing a space or `<`) and assert `result.errors.length > 0` and `result.payload` is null.

**minor — AS-132 warning tests don't assert stub retention.** The three warning tests assert only "no error, non-null payload, warning mentions the class". If a regression dropped the variant style from `payload.styles` entirely, they would still pass. I confirmed by probe that the style *is* retained today. Follow-up spec: add `expect(result.payload!.payload.styles.map(s => s.name)).toContain("md:w-1/2")` (and equivalents) to the three variant tests so the "converted as stub" half of the behaviour is pinned.

## Tooling output

### `npx tsc --noEmit`
Clean — no output.

### `npm run lint` (eslint)
```
> pm-app@0.1.0 lint
> eslint
```
Clean — no findings.

### `npx vitest run components/webflow-tool/ lib/webflow-converter/`
```
 Test Files  16 passed (16)
      Tests  477 passed (477)
   Duration  2.26s
```

### `npx vitest run` (whole repo)
```
 Test Files  252 failed | 497 passed | 1 skipped (750)
      Tests  173 failed | 3669 passed | 1687 skipped (5529)
   Duration  149.66s
```
All failures are in `tests/integration/**` and every stack terminates in
`tests/helpers/auth.ts` (`buildPool` / `ensurePool` / `getPoolIdentity`) —
live-Supabase network dependency, not reachable from this sandbox
(7s/35s/42s timeouts). None touch `components/webflow-tool/` or
`lib/webflow-converter/`. Pre-existing and out of scope for M7+M8; noted so
the orchestrator is aware the repo-wide suite is not green in a sandbox.

## Repository state
No files were modified by this review (`git status --porcelain` shows only
pre-existing untracked mission and `.playwright-mcp` artefacts).
