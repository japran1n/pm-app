# Tech decisions — Mission 20260830-223927

_This is an improvement mission on an existing project. All stack choices are already locked.
This file documents the existing stack and the patterns workers must follow._

---

## Stack

- **Language:** TypeScript 5.x (already in project)
- **Framework:** Next.js 16.3.1 (App Router, Server Actions)
  <!-- verified: latest stable is 16.3.3 per https://nextjs.org/blog/next-16-3 as of 2026-08-30 — project on 16.3.1, upgrade optional -->
- **Runtime:** React 19.2.8
  <!-- verified: React 19 useOptimistic is stable and pairs with Server Actions per https://react.dev/blog/2024/12/05/react-19 -->
- **Database:** Supabase Postgres (hosted)
  <!-- verified: @supabase/supabase-js 2.112.4 is latest per https://npmjs.com/package/@supabase/supabase-js as of 2026-08-30 -->
- **Auth:** Supabase Auth (email + password) via `@supabase/ssr`
- **Realtime:** Supabase Realtime (`postgres_changes`) — respects RLS automatically; no client-side filtering needed
  <!-- verified: https://supabase.com/blog/realtime-row-level-security-in-postgresql -->
- **UI:** Tailwind CSS v4 + shadcn/ui v4.18.0
- **Email:** Resend (transactional only)
- **Error tracking:** Sentry

---

## Libraries used

All already installed. No new packages needed for this mission.

- `react` 19.2.8 — `useOptimistic` hook for instant UI updates with auto-revert
- `@supabase/supabase-js` ^2.112.3 — Realtime subscriptions via `postgres_changes`
- `@supabase/ssr` ^0.12.4 — browser client singleton (already used by all realtime hooks)
- `sonner` ^2.0.8 — toast notifications for optimistic rollback errors
- `cmdk` ^1.1.1 — command palette (already wired up)
- `next` 16.3.1 — Server Actions used by all mutations

No new dependencies are introduced by this mission.

---

## Libraries explicitly avoided

- **React Query / SWR** — not in the project; all mutations go through Next.js Server Actions. `useOptimistic` is the correct React 19 primitive for this pattern.
- **Zustand / Jotai** — not needed; task-context for palette actions uses a lightweight React context defined in this mission.
- **Ably / Pusher** — not needed; Supabase Realtime covers all use cases and is already integrated.

---

## File layout

```
components/
  command/
    actions.ts               ← palette action registry (extend for task actions + nav)
    command-palette.tsx      ← main palette (extend for sub-lists + task context)
    shortcut-help.tsx        ← update with new shortcuts
    shortcut-provider.tsx    ← extend with g+ go-to sequence + n key
  my-tasks/
    personal-todo-list.tsx   ← add useOptimistic + mount realtime hook
    use-my-tasks-realtime.ts ← NEW (F008)
  calendar/
    use-calendar-realtime.ts ← NEW (F009)
  task/
    list-priority-select.tsx ← add useOptimistic (F001)
    list-due-date-cell.tsx   ← add useOptimistic (F002)
    task-detail-sheet.tsx    ← add useOptimistic for status/priority/title + keyboard shortcuts
    task-list-table.tsx      ← j/k navigation + inline add trigger + n key
    inline-add-row.tsx       ← NEW (F027)
lib/
  context/
    active-task-context.tsx  ← NEW (F020)
  hooks/
    use-optimistic-action.ts ← NEW (F007)
    use-shortcut.ts          ← extend with go-to shortcut primitives
  tasks/
    reconcile-calendar-realtime-task.ts  ← NEW (F010)
    reconcile-my-tasks-realtime-task.ts  ← NEW (F011)
  actions/
    palette-search.ts        ← update to use pg_trgm (F033)
supabase/
  migrations/
    <ts>_trgm_index.sql      ← NEW (F032)
```

---

## External services needed

- **Supabase** — already connected; no new credentials needed for this mission.
  Workers that touch the database schema (F032) should use the Supabase MCP if available.
- **Sentry** — already connected; no changes needed.
- **Resend** — no changes for this mission.

---

## How to run the app

```
npm run dev
```

---

## How to run tests

```
npm test
```

---

## How to run linter

```
npm run lint
```

---

## How to run type-check

```
npx tsc --noEmit
```

---

## Conventions

### Optimistic updates

Always use `React.useOptimistic` (not manual `useState` + revert) for mutations that need instant UI feedback. The canonical pattern:

```tsx
const [optimisticValue, setOptimistic] = useOptimistic(serverValue);

async function handleChange(newValue) {
  setOptimistic(newValue);
  const result = await serverAction(newValue);
  if (result?.error) {
    toast.error(result.error);
    // useOptimistic reverts automatically when the transition ends
  }
}
```

Errors must always produce a sonner toast via `import { toast } from "sonner"`.

### Realtime subscriptions

All new subscriptions must use `lib/realtime/shared-topic-channel.ts` (the ref-counted channel registry). Direct calls to `supabase.channel(topic).on(...).subscribe()` are forbidden — they break React StrictMode double-invoke.

Topic naming convention: `<entity>:<workspace_id>` e.g. `tasks:abc123`.

Cleanup: always return the unsubscribe function from the `useEffect` in the hook.

### Keyboard shortcuts

New shortcuts must:
1. Guard against `isEditableTarget(event.target)` (already in `lib/hooks/use-shortcut.ts`).
2. Guard against palette open state (check `document.querySelector('[cmdk-dialog]')` or the existing escape-layer stack).
3. Use the existing `SHORTCUT_EVENTS` CustomEvent bus for cross-component communication (do not share refs or state across distant components for shortcuts).

Two-key sequences (g + m): implement as a timeout-based sequence in `shortcut-provider.tsx`. The first key (g) starts a 1 000 ms window; any second key within that window completes the sequence. The timeout must be cleared on cleanup.

### File naming

- New hooks: `use-<noun>-<verb>.ts` e.g. `use-my-tasks-realtime.ts`
- New reconcile helpers: `reconcile-<entity>-realtime-<noun>.ts`
- New context files: `<noun>-context.tsx`

### Commits

Every worker must commit before exiting (the pre-worker-exit hook enforces this).
Commit message format: `feat(<scope>): <description>` e.g. `feat(optimistic): useOptimistic for list-priority-select`.

### MCP at run-time

Workers for F032 (migration) should use the Supabase MCP if it is registered in `connections/mcp-registry.md`. For all other features, no MCP is needed — pure application-code changes.
