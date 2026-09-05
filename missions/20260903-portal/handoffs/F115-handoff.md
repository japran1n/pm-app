# Handoff: F115 — "What happens next" on the client portal Overview

## Status
COMPLETE

## Assertions covered
This feature was assigned directly (item C of `docs/client-portal-phase-2-plan.md`) outside the normal `/mission-tasks` flow — there is no F115 feature spec, clarification file, or assigned AS-NNN IDs in `missions/20260903-portal/validation-contract.md`. Per the immutability rule this file was not touched. Coverage is instead expressed as named unit tests against the plan's own four-case + honesty-rule spec (see Files changed):

- test_AS_next_from_you_case1_open_approval_with_due_date — PASS
- test_AS_next_from_you_case1_open_approval_without_due_date_names_thing_only — PASS
- test_AS_next_from_you_case1_past_due_deliverable — PASS
- test_AS_next_from_you_case1_prefers_the_most_urgent_dated_item — PASS
- test_AS_next_from_you_case2_next_scheduled_deliverable_with_due_date — PASS
- test_AS_next_from_you_case2_next_scheduled_deliverable_without_due_date — PASS
- test_AS_next_from_you_case2_ignores_already_delivered_and_past_due_rows — PASS
- test_AS_next_from_you_case3_next_phase_decision_with_due_date — PASS
- test_AS_next_from_you_case3_next_phase_decision_without_due_date — PASS
- test_AS_next_from_you_case4_nothing_pending_with_planned_start — PASS
- test_AS_next_from_you_case4_nothing_pending_without_planned_start — PASS
- test_AS_next_from_you_case4_nothing_pending_and_no_upcoming_phase_at_all — PASS
- test_AS_next_from_you_decided_approvals_and_accepted_deliverables_do_not_count_as_owed — PASS
- test_AS_next_from_you_line_renders_under_the_headline_when_supplied — PASS
- test_AS_next_from_you_line_omitted_when_not_supplied — PASS
- test_AS_next_from_you_line_renders_in_the_honest_empty_launch_state_too — PASS

## Files changed
lib/portal/build-next-from-you.ts
lib/portal/build-next-from-you.test.ts
components/portal/launch-headline.tsx
components/portal/launch-headline.test.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx
missions/20260903-portal/handoffs/F115-handoff.md

## Commands run
`npx vitest run lib/portal/build-next-from-you.test.ts components/portal/launch-headline.test.tsx` (0, 20 passed)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0, 1 passed)
`curl` against the running dev server as nina@demo.test (see Notes) — both projects' Overview HTML confirmed by inspection, not screenshot

## Decisions made
- Built a new pure function `buildNextFromYouAnswer` in `lib/portal/build-next-from-you.ts` rather than extending `buildWaitingOnYouItems`'s output type, because the "owed now" case needs the raw `dueAt` on approvals/deliverables that `WaitingOnYouItem` deliberately narrows to a `daysWaiting` integer — reusing that narrowed shape would have meant re-deriving the date from `daysWaiting` (lossy, and the exact kind of derived-vs-source drift the codebase's own comments elsewhere warn against). Instead the new function consumes the SAME three already-fetched inputs (`openApprovalsResult`, `deliverablesResult`, plus `phasesResult` which the page already fetches for the timeline) — no fourth query, per the spec's explicit instruction.
- Case 3 ("next phase whose start requires a client decision") is modelled as the next pending `client_deliverables` row with `kind === "decision"`, rather than joining phases to `project_decision_owners` (which records authority over a *decision type*, not a per-phase gate on phase start, and has no due date to phrase honestly). This reuses the exact same `deliverables` read case 2 uses, filtered to one kind, so "decision" phrasing stays honest without inventing a phase-level "requires decision" concept the schema doesn't carry.
- Case 4's "week of 18 Sept" uses the phase's own `plannedStart` date directly (not a Monday-of-week transform) — the plan's own literal example date lands on a Friday, so deriving "week of" from a Monday-anchored week would have silently changed the stated date. Formatting the planned-start date itself is the only interpretation that never states a date the data doesn't support.
- `LaunchHeadline`'s new `nextFromYou` prop is optional; omitting it renders nothing (not an empty paragraph), so the component's three pre-existing tests needed no changes.
- A failed approvals/deliverables/phases read degrades that source to an empty list, same posture as `waitingOnYouItems` immediately above it in the page — the line may under-report until a transient read failure clears, but never crashes the page or fabricates data.

## Out-of-scope work needed
None identified for this feature. Section D (project roles) and E–H (the guide) from the same plan document are separate, larger features and were not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No feature spec, clarification file, or validation-contract assertions exist for this ad-hoc instruction (it was handed directly, referencing only the phase-2 plan doc). Proceeded using the plan section's own text as the spec, and applied the project's usual worker conventions (pure function + colocated unit test, reuse existing reads, honesty-over-invented-dates) rather than blocking for a spec that doesn't exist in this flow.
AUTONOMOUS_DECISION: Chose "sign off"/"send over"/"a decision on" as the verb per item kind (approval / past-due deliverable / decision deliverable) to match the plan's own example phrasing ("sign off the About page") rather than reusing `WaitingOnYouItem.actionLabel` ("Review"/"Open"), which reads as a UI button label, not a sentence fragment.

## Notes for the next worker
- Verified live against the running dev server (`npm run dev` on :3000) as `nina@demo.test` via `/dev-login`, using cookie-jar curl (no browser available in this environment). Confirmed by inspecting the RSC payload for `data-testid="launch-headline-next"`:
  - Project `79ef6e45-2557-46f1-bda6-91bd248832e8` (Website Redesign): `"Next from you: send over Final homepage copy — expected around 1 Sept."` — a real past-due-deliverable answer with a genuine date.
  - Project `39cda423-7c60-4fb5-b6d9-8882db9b681d` (Northwind Loyalty App — Phase 1, launched): `"Nothing needed from you right now."` — the honest case-4 empty state, no invented next-phase date because no `not_started` phase remains.
- **What to screenshot to confirm visually**: open the Overview page for each of those two projects as `nina@demo.test` (via `/dev-login?email=nina@demo.test`, workspace `acme-studio`) and screenshot the area directly under the big "On track"/confidence headline, above the risk banner / "Waiting on you" block. For Website Redesign you should see the "Next from you: send over Final homepage copy — expected around 1 Sept." line in small muted text right under the launch note. For Northwind Loyalty App — Phase 1 you should see "Nothing needed from you right now." in the same spot, with no second clause (this project has no upcoming not-started phase in the demo data, so no next-check-in date is stated — that absence is itself correct behaviour, not a bug).
- No MCP tools were used — this is pure application logic over already-fetched Supabase reads; no schema, RLS, or live-config changes were needed.
