-- Client Presentation calendar block type: lets a member flag a
-- calendar_blocks row (supabase/migrations/20261107010000_calendar_blocks.sql)
-- as a client call/presentation rather than a generic time block, so the
-- rest of the app (the block's own chip styling, and the workspace-wide
-- "presentation today/tomorrow" banner computed in
-- lib/calendar/client-presentation.ts) can single these out.
--
-- Kept as a single `block_type` text column with a closed CHECK
-- vocabulary (mirrors this repo's established "closed vocabulary via
-- CHECK, not a Postgres enum type" convention -- see notifications.kind's
-- own `notifications_kind_check`) rather than a separate boolean
-- `is_client_presentation` flag, so a third block type can be added later
-- (e.g. "internal deadline") without a second migration adding yet
-- another boolean column.
--
-- Defaults to 'general' so every existing row (and every INSERT that
-- doesn't explicitly opt in) keeps behaving exactly as it already does --
-- no backfill needed, no behavior change for any block that isn't
-- explicitly marked a client presentation.
--
-- No RLS change: `block_type` is just another column on a row already
-- covered by calendar_blocks' existing select/insert/update/delete
-- policies (see that migration's own policy definitions) -- reading or
-- writing this column is gated by the exact same visibility/ownership
-- rules as every other column on the row.

alter table public.calendar_blocks
  add column if not exists block_type text not null default 'general';

alter table public.calendar_blocks
  add constraint calendar_blocks_block_type_check
  check (block_type in ('general', 'client_presentation'));

create index if not exists calendar_blocks_client_presentation_idx
  on public.calendar_blocks (workspace_id, starts_at)
  where block_type = 'client_presentation';
