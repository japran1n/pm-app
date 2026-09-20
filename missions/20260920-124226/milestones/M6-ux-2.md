# M6 UX validation — The people switcher (pass 2)

Mission: 20260920-124226 · Run: M6-ux-2 · Date: 2026-09-20
App: `npm run dev` (Next.js 16.3.5, Turbopack) — server process started OK, but the
target route `/w/<slug>/calendar` **does not compile** and returns HTTP 500.
Driver: Playwright (Chromium) via a standalone Node script. No project code modified.
Verified against committed HEAD `00f3088d` with a clean working tree for
`components/calendar/`, `lib/queries/time-off.ts`, `lib/supabase/server.ts`.

Evidence directory:
`/Users/sasajapranin/Desktop/pm-app/missions/20260920-124226/milestones/evidence/M6-pass2/`

- `P2-00-calendar-route-build-error.png` — the Planner route, signed in, blank/500
- `P2-00b-control-board-route.png` — control capture of a sibling workspace route
- `P2-trace.txt` — step-by-step trace with HTTP status, node counts and console errors

## Verdict: pass 2 could not be executed

Every M6 behavioural assertion is `INCONCLUSIVE`. This is **not** a regression of the two
pass-1 fixes (F088 and F089 both look correct on inspection — see "Status of the pass-1
fixes" below). A later M7 feature, **F034**, broke the module graph of the Planner route,
so nothing on that route can be exercised at all.

## Blocking defect — the Planner route fails to build

`components/calendar/stacked-planner.tsx` is a client component (`"use client"` on line 20,
after its comment header). It imports `components/calendar/stacked-person-row.tsx`, which
makes a **value** import from a server-only module:

```ts
// components/calendar/stacked-person-row.tsx:8-9
import type { TimeOffEntry } from "@/lib/queries/time-off";
import { eachDateInRange } from "@/lib/queries/time-off";   // <-- value import
```

`lib/queries/time-off.ts:15` does `import { createClient } from "@/lib/supabase/server"`,
and `lib/supabase/server.ts:7` does `import { cookies } from "next/headers"`. The type-only
import on line 8 is erased; the value import on line 9 is not, so `next/headers` is dragged
into the client bundle.

Next.js reports:

```
./lib/supabase/server.ts:7:1
Error: You're importing a module that depends on "next/headers". This API is only
available in Server Components in the App Router, but you are using it in the Pages Router.

Import traces:
  #4 [Client Component Browser]:
    ./lib/supabase/server.ts [Client Component Browser]
    ./lib/queries/time-off.ts [Client Component Browser]
    ./components/calendar/stacked-person-row.tsx [Client Component Browser]
    ./components/calendar/stacked-planner.tsx [Client Component Browser]
    ./components/calendar/stacked-planner.tsx [Server Component]
    ./app/(workspace)/w/[workspaceSlug]/calendar/page.tsx [Server Component]
```

Reproduction:

1. `npm run dev`
2. Sign in to any workspace and open `/w/<slug>/calendar`
3. Observe HTTP **500**, an empty `<body>`, `0` × `[data-testid="calendar-week-label"]`,
   `0` × `[data-slot="people-switcher-trigger"]` (trace: `P2-trace.txt`)

Also reproducible outside the browser: `npx next build` fails with the same error, so this
is not a Turbopack dev-cache artefact. Introduced by commit `e7f2dab5`
*"feat(F034): render approved time-off strip above stacked person rows"*, which added the
`eachDateInRange` import.

Note: the same underlying `lib/supabase/server.ts` error is also reported for three
non-calendar import traces (`app/api/webflow-source/route.ts`, `lib/actions/portal-approval.ts`,
`components/nav/figures/requests-badge-figure.tsx` via the workspace layout). Those are
legitimate server-side consumers; they appear in the output only because Next prints every
importer of the offending module once the client trace poisons it. The single client trace
(#4/#5) is the actual fault. The control capture of `/w/<slug>/board` also rendered empty,
consistent with the shared workspace layout being caught in the failed compilation.

## Results

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-011 | INCONCLUSIVE | `evidence/M6-pass2/P2-trace.txt`, `P2-00-calendar-route-build-error.png` | Route under test returns HTTP 500; week-nav controls never render. |
| AS-012 | INCONCLUSIVE | same | Route returns HTTP 500; the switcher never renders, so `?people=` cannot be changed. |
| AS-013 | INCONCLUSIVE | same | Planner never mounts, so no storage writes can be attributed to it either way. |
| AS-051 | INCONCLUSIVE | same | `0` header nodes and `0` switcher triggers on the 500 page, in both the single- and multi-person URL shapes. |
| AS-052 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-053 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-054 | INCONCLUSIVE | same | Switcher unreachable — the F089 double-tick fix could not be visually confirmed. |
| AS-055 | INCONCLUSIVE | same | Switcher unreachable. Was already INCONCLUSIVE in pass 1 for a different (now fixed) reason. |
| AS-056 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-057 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-058 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-059 | INCONCLUSIVE | same | Switcher unreachable. |
| AS-060 | INCONCLUSIVE | same | No focusable trigger exists on the 500 page. |
| AS-061 | INCONCLUSIVE | same | Route returns HTTP 500 at every viewport. |

All fourteen previously exercised in pass 1; eleven were PASS there. They are downgraded to
INCONCLUSIVE rather than FAIL because the component code was not shown to be wrong — the
route it lives on cannot be served.

## Status of the pass-1 fixes (code read only — NOT validated at runtime)

Both fixes are present in HEAD and look correct, but neither could be exercised. They must
be re-validated once the build is green.

1. **F088 — switcher missing in the stacked layout.** `components/calendar/planner-header.tsx`
   now owns the week label, the URL-bound `PeopleSwitcherUrlBound`, the time-off dialog and
   the prev/today/next controls, and `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:146`
   renders `<PlannerHeader …/>` above the `layout === "stacked"` branch rather than inside
   `WeekView`. Structurally this is the fix pass 1 recommended. **Unverified at runtime.**
2. **F089 — double tick.** `components/calendar/people-switcher.tsx` no longer contains an
   explicit `CheckIcon`; the `data-checked` attribute is still set, so the single tick now
   comes from `CommandItem` alone. **Unverified at runtime** — pass 1 measured this by
   counting visible SVGs inside each `[cmdk-item]`, which requires a live page.

## Suggested fixes (not applied — no code was modified)

1. Move `eachDateInRange` out of `lib/queries/time-off.ts` into a server-free module (e.g.
   `lib/calendar/date-range.ts`) and import it from there in `stacked-person-row.tsx`. It is
   a pure date helper with no Supabase dependency, so it does not belong beside a query that
   constructs a cookie-bound server client.
2. Alternatively, split `lib/queries/time-off.ts` into `time-off.ts` (server: `getTimeOffEntries`,
   which alone needs `createClient`) and `time-off-shared.ts` (the `TimeOffEntry` type plus
   `eachDateInRange`), and have both the server query and the client row import the shared file.
3. Consider a guard so this class of regression is caught before a UX pass: `lib/supabase/server.ts`
   does not currently carry the `server-only` package marker. Adding it would turn this into a
   build error at the moment the bad import is written, with a pointed message, instead of a
   500 discovered later.
4. Re-run the full M6 UX suite afterwards. The pass-2 harness is ready and re-runnable at
   `/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/f211a173-a7ca-4c35-bbb5-510ee9292f2b/scratchpad/m6ux2.mjs`
   — it covers AS-011/012/013 (which pass 1 did not exercise), AS-051 in the settled stacked
   layout via hard page loads, AS-055 overflow in a settled state, AS-054 visible-tick counting
   for the F089 regression, and AS-056/057 invoked *from* the stacked layout to prove the
   pass-1 one-way-trip defect is gone. Copy it somewhere durable before the scratchpad is reaped.

## Cleanup

The dev server was stopped before exit. Three throwaway workspaces and their users were
created during this pass and left in place for reproducibility:
`m6ux2-1789929202385`, `m6ux2-1789929280987`, `m6ev-1789929447655`. Pass 1's
`m6ux-1789926140595` is also still present. Delete them with the admin client when the
milestone closes.
