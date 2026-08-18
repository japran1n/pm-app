# F223: statuses across list, search and dashboard

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F222

## Assertion IDs covered
- AS-411: list filters and the inline status editor list the project's actual columns
- AS-412: the dashboard status chart reflects custom columns
- AS-417: search results show the actual column name

## Draft scope
- List filters, inline status select, dashboard status RPC, and search result rendering all read `project_statuses`.
- Chart colours come from the column's stored colour rather than a fixed map.
- After this feature, nothing reads `tasks.status`; note the drop migration in the handoff.

## Files (approximate)
components/task/list-filters.tsx, components/task/list-status-select.tsx, supabase/migrations/ (rpc_status_counts update), components/dashboard/status-pie-chart.tsx, lib/queries/search.ts

## Notes for clarification
- The dashboard aggregates across projects with different column sets — decide whether it groups by category or by column name.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F223-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The dashboard aggregates across projects with different column sets — decide whether it groups by category or by column name.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-411, AS-412, AS-417) has a named test or a written verification note.
