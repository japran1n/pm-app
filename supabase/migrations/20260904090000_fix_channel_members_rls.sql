-- Fix infinite recursion in channel_members RLS SELECT policy.
-- The original policy's OR branch queried channel_members from within
-- a channel_members policy, causing Postgres to loop infinitely.
-- A user only ever needs to read their own membership rows, so the
-- simple user_id = auth.uid() check is sufficient.

drop policy if exists channel_members_select_own_or_shared_channel on channel_members;

create policy channel_members_select_own
  on channel_members
  for select
  to authenticated
  using (user_id = auth.uid());
