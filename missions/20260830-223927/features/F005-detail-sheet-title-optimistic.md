# F005: Optimistic title save in task detail sheet

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-009: Editing the task title in the detail sheet shows a visual saving indicator while the mutation is in flight.
- AS-010: If the title save fails, the displayed title reverts to its pre-edit value and an error toast appears.
- AS-011: Saving a title change in the detail sheet commits the edit without requiring the user to open a separate dialog.

## Draft scope
- Title field in the detail sheet: save on blur / Enter.
- Show a small pending indicator while the mutation is in flight.
- On error: revert displayed title to pre-edit value, show toast.
- No dialog; inline editing only.

## Files (approximate)
`components/task/task-detail-sheet.tsx`

## Notes
- MCP at run: none
- Find the existing title render in task-detail-sheet.tsx — it may already be an input or need converting

---

## Clarified implementation (from clarifications/F005-clarification.md)

- Pattern: Inline text input in sheet header; save on blur or Enter; `useOptimistic` for pending state
- Data shape: Optimistic state: string title; trimmed before save
- State location: Component-local; sheet receives server-confirmed title as prop
- API contract: Calls existing `updateTaskTitle` (or equivalent) server action
- Failure handling: On error: revert to pre-edit title + toast.error
- Empty state: Empty title not allowed; validate min 1 char before submitting
- Validation: 1–500 chars, trimmed; server also validates
- Performance budget: <300ms server; pending indicator shown throughout
- Access control: Inherits sheet permission check (`canWrite`)
- Touches: `components/task/task-detail-sheet.tsx` title area

### Follow-up decisions
- Pending indicator: small loading spinner next to title or muted opacity
- Escape key cancels edit and reverts to last saved title
- Enter saves; title is single line (no Shift+Enter newline)
- Don't break existing autofocus behaviour if title opens for editing
- No auto-save on keystroke — only on blur/Enter

## Definition of done

- **Primary success test:** Unit test: pending indicator appears; title saved on blur
- **Failure test:** Unit test: title reverts and toast shown on server error
- **Manual verification:** Edit title in sheet, blur — saving indicator then title commits
- **Side-effect verification:** List row title cell updates via realtime after save
- **Evidence artifact:** Test output (vitest)
