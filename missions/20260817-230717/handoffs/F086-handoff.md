# Handoff: F086 — aria labels pass

## Status
COMPLETE

## Assertions covered
AS-152: PASS — audited every interactive element in components/**/*; all icon-only buttons/links have `aria-label` or an `sr-only` visually-hidden text span, and all form inputs/selects have an associated `<Label htmlFor>` or `aria-label`. Already compliant, no code changes required.

## Files changed
(none — audit found no gaps; codebase already compliant)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run build` (0)
`npm run test` (0 for unit/vitest suite: 418 passed, 6 skipped, 80/81 files passed; 1 unrelated pre-existing failure in tests/integration/reorder-task.test.ts due to a local system-clock/JWT-issued-in-future error, not related to F086 or components/ changes)

## Decisions made
- Treated "audit + fix" per the Clarified implementation: fixed directly in-feature since scope is `components/**/*` only; no gap required touching code outside this scope, so nothing needed fixing.
- For findings with no gap, documented "already compliant" explicitly per the Clarified implementation's "On no gap found" instruction (see Audit findings below) rather than silently doing nothing.

## Out-of-scope work needed
None identified beyond components/**/*. The pre-existing failing integration test (`tests/integration/reorder-task.test.ts`, F046: AS-070/078/079/080) fails with "JWT issued at future" — a local Supabase/system-clock skew issue unrelated to accessibility or this feature's scope. Not touched, since it's outside components/ and outside AS-152.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Verified the one ambiguous case (Select's `SelectScrollUpButton`/`SelectScrollDownButton` in components/ui/select.tsx, which render `<ChevronUpIcon />`/`<ChevronDownIcon />` with no aria-label) by reading the underlying `@base-ui/react` primitive source (`node_modules/@base-ui/react/select/scroll-arrow/SelectScrollArrow.js`). Confirmed the primitive itself sets `'aria-hidden': true` on the scroll-arrow element and drives it only via `onMouseMove`/hover — it is not in the accessibility tree and not keyboard-focusable. Concluded no accessible-name gap exists there and made no change, rather than speculatively adding an aria-label to a decorative, non-interactive-per-a11y-tree element.

## Notes for the next worker
Audit method: enumerated every .tsx under components/ (40 files), identified all files importing lucide-react (24 files) as the highest-risk icon-only-button candidates, and read each file in full (not just grep excerpts) to check every Button/native-button/Input/Textarea/Select/Link for an accessible name. Findings by file:

- components/archive-project-dialog.tsx — icon-only trigger Button has `aria-label`; icon `aria-hidden`. Compliant.
- components/auth/sign-in-form.tsx — Input has `<Label htmlFor="email">`. Compliant.
- components/board/board-empty-state.tsx — disabled Button has `aria-label`. Compliant.
- components/dashboard/overdue-tile.tsx — no interactive elements; icon `aria-hidden`. Compliant.
- components/edit-project-dialog.tsx — icon-only trigger Button has `aria-label`; Inputs/Textarea have `<Label htmlFor>`. Compliant.
- components/invite-member-form.tsx — Input has `<Label htmlFor="invite-email">`. Compliant.
- components/member-role-select.tsx — `SelectTrigger` has dynamic `aria-label`. Compliant.
- components/new-project-dialog.tsx — Inputs/Textarea labeled; trigger Button has visible text. Compliant.
- components/onboarding/create-workspace-form.tsx — Input labeled. Compliant.
- components/remove-member-button.tsx — icon-only Button has dynamic `aria-label`. Compliant.
- components/revoke-invite-button.tsx — icon-only Button has dynamic `aria-label`. Compliant.
- components/task/attachment-list.tsx — delete Button has `aria-label="Delete attachment"`; file Input has sr-only `<Label htmlFor>`. Compliant.
- components/task/comment-list.tsx — delete Button has `aria-label="Delete comment"`; Input has sr-only `<Label htmlFor>`. Compliant.
- components/task/due-date-sort-header.tsx — native `<button>` has dynamic `aria-label`. Compliant.
- components/task/list-filters.tsx — all `SelectTrigger`s and Clear button have `aria-label`s. Compliant.
- components/task/tags-editor.tsx — remove-tag `<button>` has dynamic `aria-label`; Input has `<Label htmlFor>`. Compliant.
- components/task/task-card.tsx — no icon-only controls; overdue icon `aria-hidden` with sr-only text. Compliant.
- components/task/task-detail-sheet.tsx — all Inputs/Textarea/Selects have `<Label htmlFor>`; delete Button has visible text. Compliant.
- components/task/task-list-table.tsx, list-status-select.tsx — labeled via `aria-label`/visible Link text. Compliant.
- components/ui/dialog.tsx, components/ui/sheet.tsx — close Button has sr-only "Close" span (shadcn default preserved). Compliant.
- components/ui/select.tsx — scroll-up/down arrow icons have no explicit aria-label, but the underlying `@base-ui/react` `ScrollUpArrow`/`ScrollDownArrow` primitive sets `aria-hidden: true` itself and is hover-only/non-focusable — verified in node_modules source. Compliant, no change needed.
- components/ui/sonner.tsx — decorative only, no interactive elements. Compliant.
- components/workspace-switcher.tsx, project-tabs.tsx, board/*.tsx, dashboard/*.tsx — visible text on all triggers/links; chart components have no focusable DOM controls. Compliant.

No gaps found; no follow-up feature needed for AS-152.
