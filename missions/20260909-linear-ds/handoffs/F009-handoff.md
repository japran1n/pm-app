# Handoff: F009 — Reskin list/table views and board to Linear row aesthetic

## Status
COMPLETE

## Assertions covered
This feature spec was `[CLARIFIED-AUTO]` with no explicit assertion IDs assigned in the feature file itself (pure visual-only reskin task, no new behavioural assertions). No AS-NNN IDs were listed in the feature file or found assigned to F009 in the validation contract for this mission. Verified via full-suite test run that no existing assertion's behaviour regressed (see Commands run).

## Files changed
components/task/task-card.tsx
components/board/board-column.tsx
components/task/task-list-table.tsx

## Commands run
`npx tsc --noEmit -p .` (pre-existing errors only, in status-badge.tsx and a docs-markdown test — both unrelated to this feature and present before my changes; no new errors introduced)
`npx vitest run tests/unit/task-card* tests/unit/board* tests/integration/list-view* tests/integration/dashboard-task-table* components/task/task-list-table` (0 — 126/126 passed, 2 unrelated unhandled-rejection warnings from an existing `cookies()`-outside-request-scope test-environment quirk in board-taskid-deeplink.test.tsx, pre-existing and not caused by this change)
`npx vitest run` full suite (exit 0 overall; a handful of pre-existing integration test failures — invite-member.test.ts, dependency-ui-actions.test.ts, f327-project-lead-column-management.test.ts, f025-portal-route-walk.test.ts, bulk-delete-tasks.test.ts, f013-deliverables-review-and-sweep.test.ts — all in modules this feature never touches, all failing on environment issues: `revalidatePath` called outside a Next.js request/render context in the test harness, and `supabase.rpc is not a function` in a mocked client. None involve task-list-table.tsx, board-column.tsx, or task-card.tsx.)

## Decisions made
- Base `<Table>`/`<TableRow>`/`<TableHead>`/`<TableCell>` primitives in components/ui/table.tsx already carried the full Linear row aesthetic (hairline `--line-row` borders, `hover:bg-[#ffffff0d]`, `py-2.5`, uppercase `text-micro` headers) — this was already done by an earlier feature (F004's codemod). Since TaskListTable, MyTaskRowItem, and DashboardTaskTable all compose these shared primitives rather than hand-rolling their own `<tr>`/`<td>` markup, most of the row styling required zero changes; I only needed to fix the few remaining hardcoded `border-border/60` separators and `bg-muted/50` hover in task-list-table.tsx's own wrapper/child-row markup to use the same `var(--line-row)`/`hover:bg-[#ffffff0d]` tokens.
- Board cards (TaskCard): changed from the app-wide `.hover-lift` shadow-based hover (globals.css, an established cross-app convention for "this card is clickable") to `hover:bg-[#ffffff0d]` — scoped to this one component's className, not a change to the shared `.hover-lift` class definition, so no other card elsewhere in the app (portal cards, etc.) is affected. This matches the spec's explicit "No shadow on cards — elevation via bg-level-2" requirement for board cards specifically.
- BoardColumn's column background changed `bg-muted/30` → `bg-secondary` and its header text `font-semibold text-foreground` → `text-mini font-medium text-muted-foreground`, per the spec's literal column-header aesthetic.
- Card's own base classes already used `shadow-none border-border bg-card` from an earlier design-system pass (components/ui/card.tsx); I mirrored that same `border-border shadow-none bg-card` explicitly on TaskCard's own className (previously `border-border/60 bg-card`, shadow coming only from `.hover-lift`) for clarity/consistency with the spec's literal wording, though functionally the base Card component already enforced `shadow-none`.

## Out-of-scope work needed
- Other table-like surfaces outside this feature's stated scope (Portal's pages-table.tsx, change-requests-table.tsx, project-accounts-table.tsx; audit-table.tsx) were not touched — they weren't named in the spec's "core task list and board" focus, and already inherit the same shared `<Table>` primitives, so they likely already read as Linear-styled without any additional work. If the mission wants an explicit pass to confirm/adjust those, that's a separate follow-up.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The feature file (features/F009.md) contained only the tag `[CLARIFIED-AUTO]` with no assertion IDs, clarified-implementation prose, or definition-of-done text — the actual instructions came entirely from the mission-run task prompt (visual spec + "what to find and change" search list + commit message template). I treated that prompt as the full clarified spec and followed it literally: found list/board components via the suggested greps, applied the exact class tokens listed (`hover:bg-[#ffffff0d]`, `py-2.5`, `border-[var(--line-row)]`, `text-micro uppercase tracking-wide`, `font-mono` ID columns, `bg-card border border-border rounded-lg shadow-none` cards), and made zero changes to sorting/filtering/drag-and-drop/data-fetching logic anywhere.
AUTONOMOUS_DECISION: Since most of the "row aesthetic" was already implemented at the shared `components/ui/table.tsx` primitive level (presumably by F004), I limited my edits to the few remaining non-primitive hardcoded styles (task-list-table.tsx's own container/quick-add borders and isChild-row hover class, board-column.tsx's column bg/header text, task-card.tsx's card hover) rather than re-adding redundant classes that the shared Table components already apply by default.

## Notes for the next worker
- components/ui/table.tsx is the single source of truth for row/cell/header Linear styling across every table in this app (TaskListTable, MyTaskRowItem/my-task-row.tsx, portal tables, audit-table.tsx). A future worker changing row aesthetic again should edit that one file rather than each caller.
- `.hover-lift` (app/globals.css, "UX-02" comment block) is the app-wide shared card-hover convention used by many cards outside this feature's scope (portal cards, etc.) — I deliberately did NOT modify that shared class, only overrode it locally on TaskCard's own className, so as not to silently reskin every other card in the app as an out-of-scope side effect.
- No MCP tools were used — this is a pure client-side CSS/className feature with no external service or live-state dependency.
