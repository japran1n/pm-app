# Handoff: F109 — Blocked-phase reason (client-portal-visual-plan.md Part 4.1)

## Status
COMPLETE

## Assertions covered
This feature is not in `validation-contract.md` (it comes directly from
`docs/client-portal-visual-plan.md` Part 4.1, item 6 of the visual review, no
assigned AS-IDs). No assertion IDs to report; new behaviour is covered by
named tests instead (see below).

## Files changed
supabase/migrations/20261031010000_f109_phase_blocked_reason.sql (new)
lib/validation/phases.ts
lib/actions/phases.ts
lib/queries/phases.ts
lib/queries/portal.ts
components/project/phase-list.tsx
components/portal/phase-timeline.tsx
scripts/seed-demo.mjs
components/portal/phase-timeline.test.tsx
tests/unit/f087-a11y-perf-audit.test.tsx
tests/integration/f002-phase-management.test.ts
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20261031010000_f109_phase_blocked_reason.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`node scripts/seed-demo.mjs` (0) — run twice in a row, both clean, to prove idempotency
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/integration/f002-phase-management.test.ts components/portal/phase-timeline.test.tsx tests/unit/f087-a11y-perf-audit.test.tsx tests/unit/server-client-boundary-imports.test.ts tests/unit/portal-phases-query.test.ts tests/integration/portal-phases-rls.test.ts` (0) — 93 passed
`curl -s -c cookies.txt -b cookies.txt -L "http://localhost:3000/dev-login?email=nina@demo.test"` (200)
`curl -s -c cookies.txt -b cookies.txt "http://localhost:3000/portal/acme-studio/p/b1e02e94-03fb-48d3-8e4c-fd34c868919b"` (200) — response body contains the seeded reason text ("Waiting on the client's final brand assets (logo files, favicon) before cross-browser testing can start.") verbatim, confirming it renders server-side, not just compiles

## Decisions made
- **Shape: free text, not a link to `client_deliverables`/`approval_requests`.**
  Read both tables first (`20260926010000_deliverables_scope_decisions_assumptions.sql`,
  `20260916010000_approval_requests.sql`) — both already have their own
  `phase_id` FK, so a link is technically derivable with zero new columns.
  Rejected it: neither table is a closed set of "reasons a phase can stall"
  (a domain handover delay, an agency resourcing gap, or "waiting on the
  client's assets" — the actual seeded case — has no natural row in either
  table). A link would silently show nothing for every blocker not already
  modelled as a deliverable/approval, which is the exact "invent nothing, but
  say nothing when there's nothing to say" failure this feature exists to
  avoid on the read side. Free text covers every case and is cheaper (one
  nullable column, no join). A PM who wants to point at a specific
  deliverable can still name it in the text.
- **Required when `state = 'blocked'`, enforced at the app layer
  (`updatePhaseSchema`'s `.refine`), not a DB CHECK constraint.** A hard
  CHECK would also gate `seed_default_phases` / `create_project_from_template`
  (both insert a phase with a caller-supplied `state` and no
  `blocked_reason`), breaking template-based project creation the moment a
  template's phase JSON sets `state: 'blocked'`. The zod `.refine` plus the
  editor's own conditional field give the "difficult, not impossible"
  behaviour the task asked for without touching those two RPCs.
- **Editor UX**: selecting "Blocked" in the state dropdown does NOT
  immediately submit if the reason field is empty — it only updates local
  state so the (now-required) reason textarea appears, and the actual save
  fires when that field is blurred with content. This avoids a dead-end
  where selecting "Blocked" round-trips a rejected update, snaps the select
  back to its previous value, and hides the very field the user needs to
  fill in to proceed.
- **Cleared to null on any non-blocked state**: both the client submit() and
  the server `updatePhaseImpl` null out `blocked_reason` whenever the saved
  `state` isn't `blocked`, so a stale reason can never survive under an
  active/done phase and later resurface if the phase is re-blocked without
  re-entering it.
- **No column allow-list guard needed.** Grepped every migration touching
  `project_phases` for an allow-list / settled-row immutability trigger (the
  pattern used by `client_requests`, `projects`, `approval_requests` —
  `20261008010000`, `20261017010000`, `20261020010000`); none exists for
  `project_phases`. A plain `alter table add column if not exists` was
  sufficient; the check-constraint validity (500-char cap) was added
  `not valid` then `validate`d in the same migration, matching the
  low-risk-additive-column shape of the repo's other recent phase columns.
- **Undo/restore fidelity**: `blocked_reason` was added to `PHASE_COLUMNS`
  (used by both the pre-delete snapshot and the restore-insert), and to
  `restorePhaseSchema`/its insert, so deleting a blocked phase and hitting
  Undo restores its reason too — same treatment F090 item 5 already gives
  `actual_start`/`actual_end`.

## Out-of-scope work needed
- Part 4.2 (progress: count vs weighted) and Part 4.3 (`launch_confidence`
  history) from the same Part 4 of the visual plan are untouched — out of
  this feature's scope per the task.
- No UI surfaces the 500-char cap to the user (the textarea has no
  `maxLength`/counter); a future pass could add one, but the server
  rejection with a clear zod message is the current behaviour.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose free-text `blocked_reason` over a link to
`client_deliverables`/`approval_requests` for the reasons in "Decisions
made" above — the task asked me to decide and justify, no user input was
available or needed (ZERO_QUESTIONS run).
AUTONOMOUS_DECISION: Made the reason required only at the app layer
(zod refine + conditional editor field), not a DB CHECK, specifically to
avoid breaking `seed_default_phases`/`create_project_from_template`, which
predate this column and have no reasonable place to source a value from.

## Notes for the next worker
- No MCP tools were used: this is a pure schema+app change against the
  existing `project_phases` table, verified via the repo's own
  `db:apply`/`db:gen-types`/`migrations:check` scripts against the real
  hosted project (per `.env`), not Supabase MCP introspection.
- `formatQualifierLine` in `components/portal/phase-timeline.tsx` was the
  intended seam per the task and needed no new line-producing path — it now
  branches on `state === "blocked"` first checking `blockedReason`, falling
  back to the existing `blockedNeverStarted` derived note, falling back to
  nothing. Row height, aria-label, and the mobile card layout all already
  derive from this one function, so none of them needed separate changes.
- Screenshot request for the user: open `/portal/acme-studio/p/<Website
  Redesign's id>` (dev-login as `nina@demo.test`) on the Overview tab and
  screenshot the "Where we are" timeline row for "QA & accessibility" — it
  should show "Blocked" plus, on its own second line, "Waiting on the
  client's final brand assets (logo files, favicon) before cross-browser
  testing can start." instead of "Not yet started". Also worth a second
  screenshot of `Settings → Phases` for the same project, with that same
  phase's row expanded, to see the new required reason textarea under the
  state dropdown.
