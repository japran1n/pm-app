-- F068: post-submission change notification (AS-136, AS-137).
--
-- notifications_kind_check: widen for one new kind, brief_answer_changed
-- -- fired when a brief answer is saved/edited while brief.state is
-- 'submitted' or 'approved' (i.e. after the client has already handed the
-- brief off). AS-137 is satisfied by never calling create_notification at
-- all while brief.state = 'draft' (lib/actions/brief.ts's saveBriefAnswer),
-- not by anything in this migration.
--
-- Latest prior widening is 20261104900000 (Faza D, adding chat_dm /
-- chat_thread_reply on top of 20261029010000_f090's thirteen-kind union),
-- verified as the current live constraint by grepping every migration
-- that has ever touched notifications_kind_check -- no migration after
-- Faza D touches it.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'approval_decided', 'assumption_flagged',
    'budget_threshold_80', 'budget_threshold_100',
    'portal_task_decided', 'client_request_submitted', 'client_deliverable_submitted',
    'approval_owner_nudge',
    'chat_dm', 'chat_thread_reply',
    'brief_answer_changed'
  )
);

comment on constraint notifications_kind_check on public.notifications is
  'F068: widened from 20261104900000''s fifteen-kind union to add brief_answer_changed -- an answer saved/edited on a brief already in state submitted/approved, fanned out to that project''s decision owners (project_decision_owners) -- lib/actions/brief.ts''s saveBriefAnswer.';
