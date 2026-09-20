# F095: Fix server-only import leaking into client bundle

**Milestone:** M6 UX follow-up (pass 2 INCONCLUSIVE)

## Problem

`npx next build` fails with:

```
Error: You're importing a module that depends on "next/headers". This API is only
available in Server Components in the App Router.
  lib/supabase/server.ts → lib/queries/time-off.ts
    → components/calendar/stacked-person-row.tsx → components/calendar/stacked-planner.tsx
    → app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
```

Root cause: `components/calendar/stacked-person-row.tsx` makes a **value** import of `eachDateInRange` from `lib/queries/time-off.ts`. That module imports `createClient` from `@/lib/supabase/server`, which imports `cookies` from `next/headers`. This transitively drags a server-only API into a client component.

Introduced by commit `e7f2dab5` (F034).

## Fix

### Step 1 — Extract pure date helper

`eachDateInRange` is a pure date utility (no Supabase dependency). Move it to a new file:

```
lib/calendar/date-utils.ts
```

Export `eachDateInRange` from there. No `import` from Supabase or `next/headers` may appear in this file.

### Step 2 — Update imports

- In `lib/queries/time-off.ts`: import `eachDateInRange` from `@/lib/calendar/date-utils` (or remove it if it's only re-exported).
- In `components/calendar/stacked-person-row.tsx`: import `eachDateInRange` from `@/lib/calendar/date-utils` directly (not from `lib/queries/time-off`).

### Step 3 — Add server-only marker (optional but recommended)

Add `import "server-only";` at the top of `lib/queries/time-off.ts` so future accidental client imports produce a clear build error immediately.

### Step 4 — Gates

```bash
npx next build
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit
```

`next build` MUST succeed. Commit before exiting.

### Handoff

Write `missions/20260920-124226/handoffs/F095-handoff.md` with Status: COMPLETE (or BLOCKED).
