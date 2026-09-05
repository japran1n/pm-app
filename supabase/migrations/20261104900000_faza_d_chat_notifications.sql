-- Faza D (docs/chat-slack-parity-plan.md): chat notifications beyond
-- @mention, plus in-app sound/badge preferences.
--
-- ---------------------------------------------------------------------
-- notifications_kind_check: widen for two new chat-originated kinds.
-- Latest prior widening is 20261029010000_f090_approval_owner_nudge_kind
-- (the thirteen-kind union below, verified as the current live
-- constraint by grepping every migration that has ever touched
-- notifications_kind_check -- no migration after F090 touches it). Adding:
--   - chat_dm: any message sent in a DM channel (kind='dm') notifies
--     every other member, not just an @mention -- a DM has no "just
--     browsing the channel" case the way a busy workspace channel does.
--   - chat_thread_reply: a reply in a thread notifies the thread's other
--     participants (the parent's sender + anyone else who has replied),
--     mirroring `comment_reply`'s "notify watchers of the parent" shape
--     but for chat threads instead of task comments.
-- Both are written directly via lib/notifications/create-notification.ts
-- (a ChatNotificationKind, see lib/notifications/fanout.ts), never
-- through computeFanoutRecipients -- same "direct call, bypasses fan-out"
-- pattern the three PortalNotificationKind values already established.
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'approval_decided', 'assumption_flagged',
    'budget_threshold_80', 'budget_threshold_100',
    'portal_task_decided', 'client_request_submitted', 'client_deliverable_submitted',
    'approval_owner_nudge',
    'chat_dm', 'chat_thread_reply'
  )
);

comment on constraint notifications_kind_check on public.notifications is
  'Faza D: widened from 20261029010000_f090''s thirteen-kind union to add chat_dm (any message in a DM channel) and chat_thread_reply (a reply in a thread you''re part of) -- lib/actions/chat-messages.ts''s notifyChatMessageRecipients.';

-- ---------------------------------------------------------------------
-- notification_preferences: per-kind in-app columns for the two new chat
-- kinds (mirrors every existing *_in_app column's shape/default -- both
-- default true, same reasoning 20260823040000's header gives for
-- mention/task_assigned: being messaged directly is high-signal, not
-- spam), plus three columns for Faza D's in-app sound: a master
-- enable switch, a 0-100 volume, and "only play when the tab is not
-- focused" (default true -- matches Slack's own default and avoids a
-- sound firing for a message the user is already looking at).
-- ---------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists chat_dm_in_app boolean not null default true,
  add column if not exists chat_thread_reply_in_app boolean not null default true,
  add column if not exists sound_enabled boolean not null default true,
  add column if not exists sound_volume smallint not null default 60,
  add column if not exists sound_only_when_unfocused boolean not null default true;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_sound_volume_range;
alter table public.notification_preferences
  add constraint notification_preferences_sound_volume_range
  check (sound_volume between 0 and 100);

comment on column public.notification_preferences.chat_dm_in_app is
  'Faza D: gates chat_dm in-app delivery, same IN_APP_COLUMN_BY_KIND-style map convention as every other kind (see lib/actions/chat-messages.ts''s notifyChatMessageRecipients).';
comment on column public.notification_preferences.chat_thread_reply_in_app is
  'Faza D: gates chat_thread_reply in-app delivery, same convention as chat_dm_in_app above.';
comment on column public.notification_preferences.sound_enabled is
  'Faza D: master switch for the notification bell''s in-app sound (Web Audio, no static asset -- lib/notifications/sound.ts). Does not affect the visual badge/toast, only the sound.';
comment on column public.notification_preferences.sound_volume is
  'Faza D: 0-100, applied as the Web Audio GainNode''s gain (see lib/notifications/sound.ts). Consulted only when sound_enabled is true.';
comment on column public.notification_preferences.sound_only_when_unfocused is
  'Faza D: when true (default), the sound only plays while the tab is hidden/unfocused -- a notification for a message the user is already looking at does not also make a noise.';
