-- F090 item 3: adds `approval_owner_nudge`, the one new notification kind
-- `lib/actions/portal-approval.ts`'s `nudgeApprovalOwner` writes -- the
-- replacement for approval-card.tsx's old `mailto:` link.
--
-- Per this feature's own explicit warning (repeating the incident
-- documented in 20261012010000/20261019010000/20261026010000): the union
-- below is re-derived live, not copied from any one prior migration.
--
-- Live constraint read via the Supabase Management API immediately
-- before writing this migration
-- (`select pg_get_constraintdef(oid) from pg_constraint where conname =
-- 'notifications_kind_check'`):
--   mention, comment_reply, task_assigned, task_due_soon, watcher_update,
--   approval_decided, assumption_flagged, budget_threshold_80,
--   budget_threshold_100, portal_task_decided, client_request_submitted,
--   client_deliverable_submitted
--
-- Cross-checked by grep (`grep -rn "kind in (\|p_kind =>\|kind:\s*\"" \
-- supabase/migrations lib`) against every `p_kind =>` / `kind:` call
-- site that targets the `notifications` table specifically (excluding
-- unrelated `kind` columns/constraints on `task_activity`,
-- `chat_channels`, `client_requests`, `deliverables`, `task_templates`,
-- `docs` -- each of those is its own column with its own, unrelated
-- CHECK) -- the two sources agree, and match exactly.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'approval_decided', 'assumption_flagged',
    'budget_threshold_80', 'budget_threshold_100',
    'portal_task_decided', 'client_request_submitted', 'client_deliverable_submitted',
    'approval_owner_nudge'
  )
);

comment on constraint notifications_kind_check on public.notifications is
  'F090 item 3: widened from 20261026010000_f084''s twelve-kind union to add approval_owner_nudge (a client naming one decision owner to look at one still-open approval request, lib/actions/portal-approval.ts''s nudgeApprovalOwner) -- replaces approval-card.tsx''s old mailto: stopgap. Union re-derived live from pg_constraint plus every notifications p_kind => / kind: call site at the time of writing, not copied from any single prior migration.';
