-- F109 (docs/client-portal-visual-plan.md Part 4.1): the portal timeline
-- renders a `blocked` phase in `--status-blocked` -- the strongest colour
-- on the page -- with nothing saying what blocks it. Adds a free-text
-- `blocked_reason` to `project_phases` so the PM can say why, and the
-- portal can show it in place of the derived "Not yet started" note.
--
-- Shape decision (free text, not a link to `client_deliverables` or
-- `approval_requests`): checked both tables first
-- (20260926010000_deliverables_scope_decisions_assumptions.sql,
-- 20260916010000_approval_requests.sql) -- both already carry their own
-- `phase_id` FK, so a phase-to-blocker link is derivable today without
-- any new column, by querying either table `where phase_id = ...`. But
-- neither table is a closed set of "reasons a phase can stall": a phase
-- blocks just as often on a client decision with no `approval_requests`
-- row yet, a domain/DNS handover with no `client_deliverables` row, or a
-- reason external to this project entirely (the agency's own resourcing).
-- A link would cover only the subset of blockers already modelled as one
-- of those two rows and silently show nothing for every other real-world
-- case -- exactly the "invent a reason, or say nothing" choice this
-- feature exists to avoid on the OTHER side (never inventing text). Free
-- text covers every case, costs one nullable column instead of a join
-- fan-out across two tables, and a PM who wants to point at a specific
-- deliverable can still name it in the text itself ("waiting on final
-- copy for /pricing"). Cheaper and strictly more general; the plan's own
-- Part 4.1 lists this shape first for the same reason.
--
-- Required only when `state = 'blocked'` (enforced in
-- lib/validation/phases.ts's `updatePhaseSchema`, not a DB CHECK
-- constraint): a hard CHECK would also block every future write path
-- that doesn't yet know about this rule (the RPC-based
-- `create_project_from_template`/`seed_default_phases` inserts a phase
-- with a caller-supplied `state` and no `blocked_reason` at all,
-- 20260909010000/20260917020000/20260927020000/20261024010000) --
-- breaking project creation from a template whose phase JSON happens to
-- set `state: 'blocked'` is a worse outcome than a blocked phase briefly
-- missing its reason. The app-layer requirement (phase-list.tsx's editor
-- + updatePhaseSchema's refine) is enough to make "blocked with no
-- reason" difficult without making every INSERT-time caller enumerate a
-- rule that doesn't apply to them.
--
-- No allow-list/settled-row guard exists on `project_phases` today
-- (grepped every migration touching `project_phases` for `allowlist` /
-- `allow-list` / a settled-row immutability trigger a la
-- `prevent_approval_request_settled_update`,
-- 20261020010000_f009d_approvals_allowlist_guard.sql -- none found), so
-- a plain additive column needs no allow-list entry anywhere.
alter table project_phases
  add column if not exists blocked_reason text;

alter table project_phases
  add constraint project_phases_blocked_reason_length_check
    check (blocked_reason is null or char_length(blocked_reason) <= 500) not valid;

alter table project_phases
  validate constraint project_phases_blocked_reason_length_check;

comment on column project_phases.blocked_reason is
  'F109: free-text reason a blocked phase is blocked, shown to the client in place of the derived "Not yet started" note (components/portal/phase-timeline.tsx''s formatQualifierLine). Null when no reason has been recorded -- the portal never invents one. Required by the app layer (lib/validation/phases.ts) when state = ''blocked'', not by a DB CHECK, so INSERT paths that predate this column (seed_default_phases, create_project_from_template) are not broken.';
