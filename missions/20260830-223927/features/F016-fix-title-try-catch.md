# F016: Fix title save try/catch (AS-010 blocker)

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 20 min
**Depends on:** F013

## Assertion IDs covered
- AS-010: Title change reverts on server error

## Scope

`components/task/task-detail-sheet.tsx:783-791` — `handleTitleBlur` / `startTitleSaveTransition`:

```js
startTitleSaveTransition(async () => {
  const result = await editTask(task.id, { title: trimmed });
  if (result.ok) { toast.success("Title updated."); }
  else { setTitle(previousTitle); toast.error(result.error); }
});
```

On a thrown rejection (network loss, 500s), neither branch runs — no revert, no toast. Fix: wrap the `await editTask(...)` in try/catch; on catch: `setTitle(previousTitle); toast.error("Failed to save title")`.

Also add a rejecting mock test in `tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx` that covers the thrown-exception path (AS-010 throw case).

## Files
`components/task/task-detail-sheet.tsx`, `tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx`

## Clarified implementation
- Pattern: add try/catch inside startTitleSaveTransition callback
- Failure handling: catch → setTitle(previousTitle) + toast.error
- Test: mockRejectedValue(new Error("network")); assert title reverts + toast shown

## Definition of done
- AS-010: PASS — title reverts on thrown rejection + toast shown
