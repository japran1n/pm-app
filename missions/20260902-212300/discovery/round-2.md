# Discovery — Round 2 (15 gap-closing follow-ups)

_Mode: AUTO-ANSWERED (same standing instruction as round 1)._

1. **Portal overview is an RSC doing three parallel queries — do we re-query on every realtime event or patch state?** → (b) Patch local state from the payload; re-query only when the payload is insufficient (e.g. a task becomes visible and we lack its project name).
2. **What happens when a realtime INSERT arrives for a task the client cannot see?** → (a) Drop it. RLS already filters the stream, but the reconciler must also gate on `client_visible` defensively.
3. **Does the portal need presence/typing indicators?** → (d) No. Out of scope.
4. **Should `client_requests` status changes animate?** → (c) No animation; a live list re-render is enough.
5. **Approve action currently returns what?** → Server Action in `lib/actions/portal-approval.ts`; it throws on failure, so the optimistic wrapper needs try/catch (same fix class as F013).
6. **Optimistic approve — which field flips?** → (a) `pending_client_approval` → false, with the row moving out of "Waiting on you".
7. **Double-click / concurrent approve?** → (a) Guard with an in-flight ref so a second click is a no-op (same fix class as F015 toggle concurrency).
8. **Kanban — which library drives drag?** → `@dnd-kit` (`sortable-task-card.tsx`, `swimlane.tsx`). Optimistic state must live above the DndContext.
9. **Does the board persist order via an atomic RPC?** → Yes, board reorder already has a server action; the change is purely client-side optimistic state + revert.
10. **Board realtime reconcilers already exist (`reconcile-realtime-task.ts`) — extend or wrap?** → (b) Wrap: add a pending-move guard consulted by the reconciler, do not rewrite it.
11. **How is the drift guard invoked?** → (a) `npm run migrations:check`, shelling `supabase migration list --linked` and exiting non-zero on any row with an empty remote column.
12. **Does the drift guard need credentials in CI?** → (c) It reads `SUPABASE_ACCESS_TOKEN`/project ref from env; it must never print them.
13. **Channel split — one channel per table or per hook?** → (a) One channel per table binding, uniquely named, so a dead binding is isolated.
14. **Portal E2E — how does the test authenticate as a client?** → (b) Reuse the existing Playwright auth pattern in `tests/e2e` plus a client-role fixture; if no client fixture exists, the feature creates one.
15. **Portal E2E scope** → (c) One happy-path spec: client signs in → sees "Waiting on you" → approves → row leaves the section without a reload.

---

Discovery complete. 45 answers recorded (auto-answered under standing instruction).
