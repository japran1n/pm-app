-- F253 (AS-491, AS-492, AS-493): first-run guided tour dismissal state.
--
-- Persistence choice (AUTONOMOUS_DECISION, recorded in full in the
-- handoff): a single nullable timestamp column on the EXISTING `profiles`
-- table, reusing the exact same self-scoped RLS convention as
-- notification_preferences (20260823040000) and board_swimlane_prefs
-- (20260825030000) — "a user reading/writing their own row" needs no new
-- table, no new RLS policy set, and no admin client. `profiles` is
-- already the one-row-per-user identity primitive this mission's other
-- per-user prefs live next to conceptually (timezone, display_name), it
-- already has self-scoped UPDATE RLS (profiles_update_self,
-- 20260818200946_create_profiles.sql), and it is guaranteed to exist for
-- every authenticated user (the on_auth_user_created trigger). Adding a
-- THIRD per-user prefs table here would be a second source of truth for
-- "does this user have a profile row" with no behavioural upside — the
-- clarified spec's own "simpler option, no new dependency, no second
-- source of truth" instruction picks this over a new
-- `onboarding_tour_state` table.
--
-- NULL = never dismissed (tour is offered). Non-null = the timestamp the
-- user last dismissed/completed the tour — replaying (AS-493) sets it
-- back to NULL rather than deleting a row, so "has this user ever seen
-- the tour" state is a single column read, not a row-existence check.
--
-- Additive only (this mission's migration-safety convention): no existing
-- column touched, nothing dropped.
alter table public.profiles
  add column if not exists tour_completed_at timestamptz;

comment on column public.profiles.tour_completed_at is
  'F253: when the signed-in user last dismissed/completed the first-run guided tour (AS-492). NULL means the tour has never been dismissed and should be offered (AS-491). Reset to NULL to replay (AS-493). Read/written only via the caller''s own session under the existing profiles_update_self RLS policy — no new policy needed.';
