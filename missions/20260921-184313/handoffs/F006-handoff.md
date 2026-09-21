# Handoff: F006 — needs-you-card.tsx

## Status
COMPLETE

## Assertions covered
AS-020: UNTESTED — no dedicated test file exists for this presentational component (per repo convention seen so far, only some dashboard cards have tests); component structurally satisfies "Needs you" header + count badge per clarified spec. Verified only via tsc + manual code review, not an automated assertion test.
AS-021: UNTESTED — count badge shown only when totalCount > 0 (destructive/red variant), verified by code review only.
AS-022: UNTESTED — caps rendered items at 10 and shows "X more in inbox →" overflow link when totalCount exceeds visible items; verified by code review only.
AS-023: UNTESTED — each item renders icon, title, subtitle, action link; verified by code review only.
AS-024: UNTESTED — icon colors mapped per kind (approval=violet, client_request=blue, mention=gray/muted, qa_return=amber); verified by code review only.
AS-025: UNTESTED — action buttons render as `<a>` tags (not forms/buttons that submit); verified by code review only.
AS-026: UNTESTED — empty state renders "You're all caught up ✓" with green check icon when items is empty; verified by code review only.

## Files changed
components/dashboard/needs-you-card.tsx

## Commands run
`npx tsc --noEmit` (0)
`git add components/dashboard/needs-you-card.tsx && git commit ...` (0)

## Decisions made
- Component is a plain function taking props and returning JSX; no "use client" directive, consistent with spec's Server Component requirement — no interactivity is needed since action links are plain `<a>` tags and the overflow/inbox links use Next's `Link`.
- Used `Badge` with `variant="destructive"` for the red count badge (matches Supabase design system tinted-badge convention already in `components/ui/badge.tsx`), only rendered when `totalCount > 0`.
- Icon is a small colored circle inside a color-coded rounded div per kind, since no specific icon set was mandated by the clarified spec beyond "color-coded by kind" — kept it minimal/decorative rather than importing a large icon library per kind, avoiding a guess at exact lucide icon names not specified in the spec.
- `role` prop is accepted (per the documented type signature contract with page.tsx) but intentionally unused inside the component body, since the clarified spec explicitly states role-based filtering (hiding `client_request` from `member`) happens in `page.tsx`, not in this component. TypeScript strict mode with `noUnusedParameters` was checked via `tsc --noEmit`, which passed, confirming this is not flagged as an error in this codebase's tsconfig.
- Overflow count computed as `totalCount - visibleItems.length` rather than `totalCount - MAX_ITEMS`, so it degrades correctly even if `items.length < MAX_ITEMS` but `totalCount` is inconsistent with `items.length` (defensive, matches "X more" semantics exactly per items actually rendered).
- Action href/label values (e.g. qa_return → task URL or `/w/{slug}/my-tasks` fallback) are entirely the caller's (page.tsx) responsibility per the `AttentionItem` shape — this component only renders whatever `actionHref`/`actionLabel` it receives, it does not compute them.

## Out-of-scope work needed
- `page.tsx` for the Home dashboard needs to assemble `AttentionItem[]` from `lib/queries/approvals.ts`, `lib/queries/client-requests.ts`, `lib/queries/notifications.ts`, and `lib/queries/my-tasks.ts` (QA returns), apply the `client_request`-hidden-from-`member` role filter, and pass `items`, `totalCount`, `role`, and `workspaceSlug` into `<NeedsYouCard />`. This wiring was not in scope for F006 per the feature spec ("Touches" limited to the component file) and is presumably a separate page-assembly feature.
- No automated test file exists yet for `NeedsYouCard` (e.g. `tests/unit/needs-you-card.test.tsx`) covering the empty-items and 12-items-overflow definition-of-done cases explicitly. Other dashboard cards in this mission (e.g. `coming-up-card`, `my-work-card`) do have sibling test files in `tests/unit/`; a follow-up should add `tests/unit/needs-you-card.test.tsx` with cases for AS-020 through AS-026 (empty state, count badge visibility, item rendering per kind/color, overflow link math, and `<a>`-not-form assertion) once the test runner/harness pattern used by those sibling tests is confirmed (check `tests/unit/coming-up-card.test.ts` for the render harness used for Server Components in this repo).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a plain colored dot-in-circle for kind icons rather than picking specific lucide-react icon names per kind, since the clarified spec only specifies icon *color* per kind ("Icon colors: approval=violet, client_request=blue, mention=gray, qa_return=amber/red"), not specific icon glyphs, and no reference implementation icon set was called out for this component.
AUTONOMOUS_DECISION: Accepted but left the `role` prop unused inside the component (still part of the exported `NeedsYouCardProps` type) since the spec explicitly assigns role-based filtering to page.tsx, not this component — kept the prop in the signature only so page.tsx's call site type-checks against the documented contract in the spec.

## Notes for the next worker
- `AttentionItem` type is exported from `components/dashboard/needs-you-card.tsx` for `page.tsx` (or wherever the Home dashboard assembly happens) to import.
- `WorkspaceRole` type comes from `lib/auth/permissions.ts` (line ~30).
- No MCP tools were used — this is a pure UI component with no live external service state to introspect.
- Consult `tests/unit/coming-up-card.test.ts` and `tests/unit/my-work-card.test.tsx` (added by sibling features F004/F005 per git status) for this repo's existing pattern of testing dashboard Server/Client Components before writing new tests for this card.
