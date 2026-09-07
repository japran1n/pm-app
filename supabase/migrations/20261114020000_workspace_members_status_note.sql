-- Out-of-office status note: a short free-text note a member sets on
-- their own membership row ("Vraćam se ponedeljak") plus an optional
-- expiry date after which the note stops being shown. Lives on
-- workspace_members (not profiles) because the note is scoped per
-- workspace membership, matching this feature's own wording ("na profilu"
-- meaning the per-workspace member's profile card, not the cross-
-- workspace `profiles` row that display_name/avatar_url/timezone live on).
--
-- No RLS changes needed: `workspace_members` already has a
-- select-for-fellow-active-members policy (every column, including these
-- two new ones, is already visible to any active member of the same
-- workspace) and an owner-can-update-own-row path is added below.

alter table public.workspace_members
  add column if not exists status_note text,
  add column if not exists status_note_until date;

alter table public.workspace_members
  add constraint workspace_members_status_note_not_blank
  check (status_note is null or btrim(status_note) <> '');

-- Self-service update: a member may update ONLY their own row's
-- status_note/status_note_until (enforced at the application layer in
-- lib/actions/status-note.ts, which re-checks `user_id = auth.uid()`
-- before writing) -- but the actual DB write already needs a policy that
-- allows it. workspace_members has no generic "member updates own row"
-- policy yet (existing UPDATE policies, e.g. role changes, are
-- owner/admin-only), so this feature adds one scoped narrowly to a
-- member updating their own status note. Using `with check` mirroring
-- `using` keeps a member from re-pointing the update at someone else's
-- row via a crafted request.
drop policy if exists workspace_members_update_own_status_note on public.workspace_members;

create policy workspace_members_update_own_status_note
  on public.workspace_members
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
