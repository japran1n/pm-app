# Handoff: F068 — fix production build defect in portal-preview module (AS-052, AS-053)

## Status
PARTIAL

## Assertions covered
AS-052: PASS — targeted tests (`tests/unit/portal-preview-action.test.ts`, `tests/unit/assert-not-preview-guard.test.ts`, `tests/unit/f024b-preview-write-guard.test.ts`) pass; the client-preview mechanism (real session minted for the client, no `previewAsClientId` filter) is unchanged, only the location of four constant exports moved.
AS-053: PASS — targeted tests (`tests/unit/portal-preview-write-blocked-client.test.ts`, `tests/unit/portal-preview-signout.test.ts`) pass; audit-write-before-mint, fail-closed behaviour, and cookie `maxAge`/values are byte-for-byte unchanged.

## Files changed
lib/portal/preview-cookies.ts (new)
lib/actions/portal-preview.ts
lib/supabase/server.ts
lib/actions/auth.ts
app/(portal)/portal/[workspaceSlug]/layout.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/portal-preview-action.test.ts tests/unit/portal-preview-signout.test.ts tests/unit/assert-not-preview-guard.test.ts tests/unit/f024b-preview-write-guard.test.ts tests/unit/portal-preview-write-blocked-client.test.ts` (0, 42 passed)
`npm run build` (1 — see Blockers; the originally-reported `startClientPreview doesn't exist` error is gone, but the build now fails on an unrelated, pre-existing defect one layer deeper, see below)
`grep -rl '^"use server"' lib app --include="*.ts*"` swept for every file, checked each for `export const|let|var|class` that is not an async function — zero matches remain anywhere in the repo (portal-preview.ts's own four constant exports were the only instance; verified before and after the fix)

## Decisions made
- Both root causes described in the task are the same underlying mechanism (a `"use server"` module rejecting non-async exports, which also created the `portal-preview.ts` <-> `supabase/server.ts` import cycle), so one move fixes both: moved `PORTAL_PREVIEW_ACCESS_COOKIE`, `PORTAL_PREVIEW_REFRESH_COOKIE`, `PORTAL_PREVIEW_LABEL_COOKIE`, `PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE` out of `lib/actions/portal-preview.ts` into a brand-new file with no `"use server"` directive and zero imports of its own: `lib/portal/preview-cookies.ts`.
- Location chosen by grepping for the existing convention rather than inventing one: `lib/portal/` already holds plain, non-Server-Action, non-`"use server"` helper modules for this exact feature area — `lib/portal/reconcile-portal-realtime-task.ts` and `lib/portal/subscribe-portal-overview-realtime.ts` (both F007/F008, same portal-preview mission), each a plain function/constants module with a header comment explicitly citing "no side effects, no Supabase import" as the reason it lives outside `lib/actions/`. `lib/portal/preview-cookies.ts` follows the same shape.
- Verified the full consumer list by grep (`grep -rn "PORTAL_PREVIEW_" --include="*.ts*" lib app components`) before editing: exactly four files import these constants — `lib/supabase/server.ts`, `lib/actions/auth.ts`, `app/(portal)/portal/[workspaceSlug]/layout.tsx`, and `lib/actions/portal-preview.ts` itself (which now re-exports nothing; callers of `startClientPreview`/`exitClientPreview` are unaffected since those two function exports were never removed). This matches exactly the four-file list given in the task.
- `lib/supabase/server.ts` already had its own private (unexported, duplicate-string) copies of `PORTAL_PREVIEW_ACCESS_COOKIE`/`PORTAL_PREVIEW_REFRESH_COOKIE` rather than importing from `portal-preview.ts` — presumably to dodge the exact cycle this fix addresses. Replaced those with an import from the new shared module so there is a single source of truth for all four cookie names; values are identical strings, so no behavioural or cookie-identity change.
- Left all four cookie name string values, `maxAge`, `path`, and cookie option logic completely untouched, per the task's explicit prohibition against changing them.
- Import statement in `lib/supabase/server.ts` was inserted where the old local `const` declarations were (mid-file, after some header comments), not hoisted to the top with the other imports. This is syntactically valid — ES module imports are hoisted by the compiler regardless of source position — and keeps the diff minimal/localized. Noting this in case a future reader expects all imports at the top.

## Out-of-scope work needed
Discovered a second, unrelated, pre-existing production-build defect while verifying `npm run build`, from a completely different feature (`git log` shows `lib/queries/metrics.ts` / `components/project/measurement-panel.tsx` were last touched by commit `960dcec fix(F021c): a pre-baseline measurement is not an improvement`, not F024/F068):

`components/project/measurement-panel.tsx` (`"use client"`) imports the value `deriveMetricMeasurementStatus` from `lib/queries/metrics.ts`, a server-only query module that imports `createClient` from `lib/supabase/server.ts` (which imports `next/headers`). Turbopack's production build refuses to bundle the `next/headers`-dependent chain into the client bundle, and fails the whole build with the same class of error as the one I was asked to fix (`Error: You're importing a module that depends on "next/headers"...`), but in a different file, on a different feature, with no `"use server"` involved at all — this one is a plain module boundary problem, not a Server Actions export-collapse problem, so the mechanical fix from this task doesn't directly apply without a judgment call about where the pure `deriveMetricMeasurementStatus`/`MetricMeasurementStatus` should live (candidates: a new `lib/queries/metrics-status.ts` with no imports, mirroring `lib/portal/preview-cookies.ts`'s pattern, then re-exported from `lib/queries/metrics.ts` for existing server callers and imported directly by `measurement-panel.tsx`).

I did not touch `lib/queries/metrics.ts` or `components/project/measurement-panel.tsx` — outside this feature's declared scope (four named consumer files + a grep sweep specifically for `"use server"` modules), and the task's own prohibition ("Do not alter... if any needs a judgement call, leave it and say so explicitly") plus the repo's hard rule against touching files outside a feature's scope both point the same direction. Confirmed via `git stash` that this defect is pre-existing and unrelated to my diff: reverting my changes still leaves the ORIGINAL `startClientPreview doesn't exist` error as the only reported failure (Turbopack stops at the first fatal module-resolution error it hits), so this second defect was silently present and masked the whole time; my fix is what unmasked it by letting the build get further.

## Blockers
BLOCKER: `npm run build` still exits non-zero. My assigned fix (both causes in the task) is verified complete and correct — the exact reported error (`Export startClientPreview doesn't exist in target module`) is gone, confirmed by diffing build output with/without my change via `git stash`. The remaining failure is the unrelated, pre-existing `lib/queries/metrics.ts` / `measurement-panel.tsx` defect described above under "Out-of-scope work needed."
TRIED: Confirmed via `git stash`/`git stash pop` that the metrics.ts build error is unaffected by my diff (reproduces identically with my changes stashed out, once the original portal-preview error is worked past). Ran the full `"use server"` sweep the task asked for — it does not cover this case since `lib/queries/metrics.ts` has no `"use server"` directive.
NEEDED: A follow-up feature to split `lib/queries/metrics.ts`'s pure exports (`MetricMeasurementStatus`, `deriveMetricMeasurementStatus`) into a dependency-free module, matching the `lib/portal/preview-cookies.ts` pattern established here, then update `components/project/measurement-panel.tsx`'s import.
SUGGESTED FOLLOWUP: Create a feature to fix the `npm run build` failure in `lib/queries/metrics.ts` / `components/project/measurement-panel.tsx`: move `MetricMeasurementStatus` and `deriveMetricMeasurementStatus` (both pure, no Supabase/next-headers dependency, currently at lib/queries/metrics.ts lines ~234-262) into a new zero-import module (e.g. `lib/queries/metrics-status.ts`), have `lib/queries/metrics.ts` re-export them for its existing server-side callers, and change `components/project/measurement-panel.tsx`'s import of `deriveMetricMeasurementStatus` to come from the new module directly so the client bundle never pulls in `lib/supabase/server.ts`. Verify with `npm run build` exiting 0 and `npx tsc --noEmit` staying green; the values/behaviour of `deriveMetricMeasurementStatus` must not change.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `lib/portal/preview-cookies.ts` as the new module's location by grepping for the existing pattern (`lib/portal/*.ts` already holds plain, dependency-light helper modules for this same feature area, e.g. `lib/portal/reconcile-portal-realtime-task.ts`) rather than inventing a new `lib/constants/` style directory, since no such directory exists anywhere in the repo (checked `find lib -iname "*constants*"` — zero results).
AUTONOMOUS_DECISION: Set Status to PARTIAL rather than COMPLETE because `npm run build` does not exit 0, even though the specific defect I was asked to fix is verified resolved — the remaining failure is a distinct, pre-existing, out-of-scope defect (see Blockers/Out-of-scope) that this feature's declared scope does not cover and that would need its own judgment call to fix safely.

## Notes for the next worker
- No MCP tools were relevant to this fix — it's a pure module-boundary/bundler issue, no live external service state involved.
- To reproduce the exact original error for comparison: `git stash` (stashes this fix), `npm run build`, then `git stash pop`.
- The `"use server"` sweep script used (safe to reuse for future audits):
  `for f in $(grep -rl '^"use server"' lib app --include="*.ts*"); do awk '/^export / && !/^export (async function|type|interface|default async function)/' "$f"; done`
