# Handoff: F247 — task-modal-routing

## Status
COMPLETE

## Assertions covered
AS-475: PASS — `test_AS_475_open_task_from_click_pushes_taskId_via_router_push_preserving_other_params` and `test_AS_475_open_task_from_url_fromUrl_option_does_not_push_a_duplicate_history_entry` (`tests/unit/f247-task-modal-routing.test.tsx`) prove opening pushes `?taskId=` via `router.push(..., { scroll: false })` — a client-side soft navigation, not a full reload — with every other existing search param preserved verbatim.
AS-476: PASS — three tests cover both the happy path and the failure mode the spec explicitly calls out: `test_AS_476_close_after_an_in_app_open_uses_router_back_to_restore_the_prior_entry` (in-app open → close uses `router.back()`), `test_AS_476_close_after_a_direct_load_with_no_prior_history_falls_back_to_replace` and `test_AS_476_close_after_an_in_app_open_falls_back_to_replace_when_no_browser_history_exists` (both prove the `router.replace` fallback genuinely fires — one for a direct/refresh load, one for the "opened in-app but no navigable history" edge case — rather than trusting the draft's comment claim).
AS-478: PASS — `test_AS_478_onOpenChange_false_after_a_router_back_style_url_change_does_not_double_navigate` (URL already lost `taskId` before React notices, `closeFromUrl` must not double-navigate) and `test_AS_478_escape_via_the_shared_layer_stack_closes_the_open_task_sheet` (renders the real `<Board>` + `<TaskDetailSheet>`, calls the exact `popTopEscapeLayer()` the global shortcut provider calls on a real Escape keydown, asserts it returns `true` and the sheet actually unmounts) — the second test exists because the draft never registered `TaskDetailSheet` in F244's Escape-layer stack at all; this worker added that registration (see Decisions made).

## Files changed
components/board/board.tsx (kept from draft, unmodified further)
components/task/use-task-detail-sheet.ts (kept from draft, unmodified further)
components/task/task-detail-sheet.tsx (added `useEscapeLayer` registration — new, not in the draft)
tests/unit/f247-task-modal-routing.test.tsx (new)
tests/unit/board-task-detail-sheet-wiring.test.ts (updated one source-inspection regex to match the draft's new `openTask(id, { fromUrl: true })` call signature)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — identical baseline: `lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`, `tests/unit/palette-actions-recents.test.tsx`, none touched by this feature)
`npx next build` (0 — Turbopack production build succeeded, `/w/[workspaceSlug]/t/[taskKey]` and every other route still listed)
`npx vitest run tests/unit/f247-task-modal-routing.test.tsx` (0 — 7/7 passed)
`npx vitest run tests/unit/board-taskid-deeplink.test.tsx tests/unit/shortcut-provider.test.tsx tests/unit/shortcut-help.test.tsx tests/unit/f246-task-detail-sheet-copy-link.test.tsx tests/integration/f246-task-deep-link-route.test.ts` (0 — 33/33 passed, regression check on every file this feature's own spec named plus the Escape-stack/deep-link-route files it touches semantically)
`npx vitest run tests/unit/board-task-detail-sheet-wiring.test.ts` (0 — 9/9 passed, after updating its one regex to the draft's new call signature)
`npx vitest run tests/unit` (0 — 137 files / 1060 tests, all passed. One documented pre-existing unhandled-rejection warning from `tests/unit/user-avatar.test.tsx`, same `cookies()`-outside-request-scope noise F246's handoff already disclosed, unrelated to this feature's files.)

## Decisions made
- **Kept the draft's core approach** (extend `useTaskDetailSheet` to drive `router.push`/`router.back`/`router.replace` on the SAME `?taskId=` param F246 already established) rather than building the spec's "Draft scope" intercepting/parallel-route sketch. This is the correct application of the clarification's "take the simpler option that adds no new dependency and no second source of truth" rule: F246's handoff explicitly left this seam clean for exactly this reason, and forking a second, route-based contract (`@modal/(.)tasks/[taskKey]`) alongside the existing `?taskId=` mechanism every other caller (notifications, calendar, board's own card click) already uses would be the "second source of truth" the clarification instructs against. Recorded here since it's a deviation from the spec's own "Files (approximate)" list, which is expected — that list was explicitly a draft sketch, not the clarified answer.
- **Verified, not trusted, the draft's three riskiest claims**, per this feature's explicit instructions:
  - "Back works by construction" (comment in the draft) — proven with a real test (`test_AS_478_onOpenChange_false_after_a_router_back_style_url_change_does_not_double_navigate`) rather than accepted from the comment.
  - "The `router.replace` fallback genuinely triggers when someone lands directly on a `?taskId=` URL with no in-app history" — proven with two separate tests covering both ways this can happen (never pushed by this hook at all; pushed by this hook but the environment reports no navigable history), not just the first.
  - Escape "closing" — the draft did NOT implement this at all (no `useEscapeLayer` call anywhere in `task-detail-sheet.tsx`); I read the spec's explicit "Escape must... cooperate with F244's Escape-layer stack" requirement, found `TaskDetailSheet` absent from the stack (confirmed via `grep -n useEscapeLayer components/`), and added the registration myself, following the identical pattern `NewTaskDialog` (F244's own reference implementation) already uses: `useEscapeLayer(open, () => onOpenChange(false))`. Without this, pressing Escape while the Sheet is open relied entirely on Radix's own internal Escape handling, which never coordinates with a stacked-on-top overlay (e.g. a confirm dialog opened from inside the Sheet) the way the shared stack does — exactly the "fighting" failure mode the spec warned against.
- **`getTaskDetail` reuse verified, not re-implemented**: `use-task-detail-sheet.ts`'s `fetchDetail` was already calling the real, F323-hardened `getTaskDetail` from `lib/actions/tasks.ts` before this feature (inherited from F039/F246); this feature added zero new fetch paths. No `createAdminClient()` call was added anywhere in this feature's files.
- **Client-boundary check (F330)**: `use-task-detail-sheet.ts` and `board.tsx` are both `"use client"`; their new imports (`usePathname`/`useRouter`/`useSearchParams` from `next/navigation`, `useEscapeLayer` from `lib/hooks/use-shortcut.ts`) are all client-safe — `use-shortcut.ts` has no `next/headers`/`server-only` import anywhere in its own module graph (verified by reading the file in full). No new import of `lib/supabase/server.ts` or any constant from it was introduced.
- **`board-task-detail-sheet-wiring.test.ts`'s source-inspection regex was updated**, not left broken — it asserted the literal old `taskDetailSheet.openTask(requestedTaskId);` call text, which the (kept) draft legitimately changed to `taskDetailSheet.openTask(requestedTaskId, { fromUrl: true })` so the URL-driven open path doesn't re-push a duplicate history entry. This is a mechanical regex update to match a real, intentional signature change in this feature's own scope, not a scope expansion.

## Out-of-scope work needed
- None beyond what F246's own handoff already disclosed (rewiring notifications/calendar/palette onto the canonical `/w/{slug}/t/{key}` route is still open, unrelated to this feature).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: kept the draft's "extend the existing `?taskId=` hook" approach over the spec's intercepting-route sketch — see Decisions made for the clarification-rule justification.
AUTONOMOUS_DECISION: added `TaskDetailSheet`'s missing `useEscapeLayer` registration (the draft never added it) to satisfy the spec's explicit Escape/F244-cooperation requirement, following `NewTaskDialog`'s existing pattern exactly.

## Notes for the next worker
- MCP usage: none — this feature is pure client-side routing/state, no schema or live external-service change (`mcp-registry.md` lists "MCP at run: none" for this feature, consistent with F246's own note).
- `use-task-detail-sheet.ts`'s `pushedTaskIdRef` is the load-bearing bit for the AS-476 fallback logic — it's `true` only for a taskId THIS hook pushed via a click, `false` for one that was already in the URL when the hook first opened it (direct load/refresh/URL-driven open). `onOpenChange(false)` uses `router.back()` only when BOTH `pushedTaskIdRef.current` AND `window.history.length > 1` are true; anything else falls back to `router.replace`. Both branches now have dedicated tests.
- The Escape-layer registration I added lives at `components/task/task-detail-sheet.tsx` right after `syncedTaskId`'s `useState`, mirroring where `NewTaskDialog` places its own `useEscapeLayer` call relative to its `open` state.
- `tests/unit/f247-task-modal-routing.test.tsx`'s last test dynamically imports `@testing-library/react`/`react`/`@/components/board/board` inside the `it()` body (rather than at module top level) specifically so it can call `vi.doMock` for `@/lib/actions/comments` and set `currentSearch` before those modules are first evaluated — the other tests in the same file only exercise the hook directly via `renderHook` and don't need this.
