# F130 — Fix AS-006: 9 pre-existing unit test failures

_Mission: 20260919-150607_ _Milestone: M9_

## Problem

`npx vitest run tests/unit` exits 1 with 9 failing files / 30 failing tests. The scrutiny validator correctly noted these cannot be marked "acceptable baseline" while AS-006 claims the suite passes.

The failures are:
1. `tests/unit/watching-feed-query.test.ts` — `TypeError: supabase.rpc is not a function` (mock missing `rpc`)
2. `tests/unit/f042-no-approval-lock-comments.test.ts` — AS-172 guard fires on `comment` appearing inside a JSX comment string
3. `tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx` — `supabase.auth` undefined
4. `tests/unit/f022-board-realtime-guard-call-site.test.tsx` — `supabase.auth` undefined  
5. `tests/unit/f027-calendar-realtime-wiring.test.tsx` — `supabase.auth` undefined
6. `tests/unit/f039-portal-guards.test.ts` — `supabase.auth` undefined
7. `tests/unit/f251-list-table-realtime.test.tsx` — `supabase.auth` undefined
8. `tests/unit/personal-todo-list-realtime-wiring.test.tsx` — `supabase.auth` undefined
9. `tests/unit/undo-toast.test.tsx` — likely related

## Fix

Work through each failing test file:

### 1. watching-feed-query.test.ts
Find the Supabase mock setup in this test file. It creates a mock client but doesn't include `rpc`. Add `rpc: vi.fn().mockReturnValue({ data: [], error: null })` (or the appropriate chainable mock) to the mock client object so `getWatchedTasksForUser` can proceed past line 112.

### 2. f042-no-approval-lock-comments.test.ts  
The test scans for the literal string `comment` in JSX but JSX comments (`{/* comment */}`) contain the word `comment`. Narrow the regex or assertion to exclude JSX/HTML comment nodes — change from a broad text scan to something that checks actual text nodes or narrows the match pattern. Read the test to understand the exact assertion, then fix it to exclude JSX comment strings from the false positive.

### 3-8. Realtime hook test files (supabase.auth undefined)
Find where these tests set up the Supabase mock. They share a pattern: the mock client lacks `supabase.auth`. Find the shared mock or per-file mock and add:
```ts
auth: {
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } }, error: null }),
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
}
```
to the mock client. Check if there is a shared `__mocks__/supabase.ts` or similar; if so, patch it there once.

### 9. undo-toast.test.tsx
Run this test in isolation first to see the actual error, then fix.

## After fixing

Run `npx vitest run tests/unit --reporter=verbose`. All 505 files must pass (0 failures).
Run `npx tsc --noEmit` — exit 0.
Commit and write handoff to `missions/20260919-150607/handoffs/F130-handoff.md`.

## Scope constraint

Do NOT fix integration tests (`tests/integration/**`) — those require a live Supabase instance and are out of scope. Only fix `tests/unit`.
