-- F033: architecture_node_meta.client_visible has 0 true rows (confirmed by
-- F031); safe to drop. No portal surface ever read this table, so the
-- companion client SELECT RLS policy (architecture_node_meta_select_client,
-- added in 20261127021000_architecture_node_meta.sql) has no readers either
-- and is dropped alongside the column.
drop policy if exists architecture_node_meta_select_client on public.architecture_node_meta;

alter table public.architecture_node_meta
  drop column if exists client_visible;
