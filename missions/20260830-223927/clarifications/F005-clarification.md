# F005 Clarification — Optimistic title save in task detail sheet

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Inline text input in sheet header; save on blur or Enter; `useOptimistic` for pending state
2. **Data shape** ★ Optimistic state: string title; trimmed before save
3. **State location** ★ Component-local; sheet receives server-confirmed title as prop
4. **API contract** ★ Calls existing `updateTaskTitle` (or equivalent) server action
5. **Failure handling** ★ On error: revert to pre-edit title + toast.error
6. **Empty state** ★ Empty title not allowed; validate min 1 char before submitting
7. **Validation** ★ 1–500 chars, trimmed; server also validates
8. **Performance budget** ★ <300ms server; pending indicator shown throughout
9. **Access control** ★ Inherits sheet permission check (`canWrite`)
10. **Touches** ★ `components/task/task-detail-sheet.tsx` title area

## Round B — Follow-ups

11. ★ Pending indicator: small loading spinner next to title or muted opacity on the input
12. ★ Escape key cancels edit and reverts to last saved title
13. ★ Enter saves; Shift+Enter inserts newline if title supports it (no — title is single line)
14. ★ Autofocus title input when sheet opens (already existing behaviour — don't break it)
15. ★ Debounce: no auto-save on keystroke — only on blur/Enter to avoid excessive server calls

## Definition of done

16. **Primary success test** ★ Unit test: pending indicator appears; title saved on blur
17. **Failure test** ★ Unit test: title reverts and toast shown on server error
18. **Manual verification** ★ Edit title in sheet, blur — saving indicator then title commits
19. **Side-effect verification** ★ List row title cell updates via realtime after save
20. **Evidence artifact** ★ Test output (vitest)
