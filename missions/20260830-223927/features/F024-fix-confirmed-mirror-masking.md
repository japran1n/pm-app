# F024: Fix confirmed mirror masking optimistic value on 2nd+ change

**Milestone:** M1
**Estimated worker time:** 20 min
**Depends on:** F023

## Assertion IDs covered
- AS-005: Status change updates badge immediately (every change, not just first)
- AS-007: Priority change updates badge immediately (every change, not just first)

## Root cause

`task-detail-sheet.tsx` (F023) added `confirmedStatus`/`confirmedPriority` and reads them AHEAD of the optimistic value:

```tsx
value={confirmedStatus ?? optimisticStatus ?? task.status}
value={confirmedPriority !== undefined ? confirmedPriority : optimisticPriority !== undefined ? optimisticPriority : task.priority}
```

`confirmedStatus`/`confirmedPriority` are set when a save resolves successfully and only cleared when a different task opens. So the 2nd+ change in the same open sheet: the confirmed mirror from the previous save masks the new optimistic value during the transition.

UX validator observed:
- 1st priority change: immediate ✓
- 2nd priority change: shows previous confirmed value until server responds ✗

## Fix

Clear the confirmed mirror INSIDE the transition, BEFORE the await, so it does not mask the new optimistic value:

```tsx
startStatusTransition(async () => {
  setConfirmedStatus(undefined); // clear mirror before await
  setOptimisticStatus(next);
  // ... await action
});
```

Same for priority.

The confirmed mirror is only needed to prevent snap-back after the transition settles. It should be undefined during the transition itself.

## Files
`components/task/task-detail-sheet.tsx`

## Definition of done
- AS-005: PASS — every status change (1st, 2nd, 3rd) is immediately reflected in the badge
- AS-007: PASS — every priority change is immediately reflected
- AS-006, AS-008: still PASS — revert path still works
