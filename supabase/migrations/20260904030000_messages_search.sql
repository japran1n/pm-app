-- F12 (docs/advanced-chat-plan.md): full-text search over chat messages.
--
-- Ordinary column (not a `generated always as` computed column) populated
-- server-side in lib/actions/chat-messages.ts's sendMessage, per the plan's
-- explicit recommendation: the server already runs extractPlainText()
-- (lib/comments/rich-text.ts) on the Tiptap JSONContent body before insert,
-- so re-deriving the same plain text via Postgres-side JSON parsing in a
-- generated column would be strictly more expensive for no benefit. If F13
-- ever changes body_json's shape, extractPlainText already knows how to
-- flatten richer node trees -- this column stays a plain server-set value.
alter table messages
  add column if not exists body_text text not null default '';

comment on column messages.body_text is
  'F12: plain-text projection of body_json, populated by lib/actions/chat-messages.ts (sendMessage/editMessage) via lib/comments/rich-text.ts''s extractPlainText(). Backing column for messages_body_text_search_idx (to_tsvector(''english'', body_text)) -- never edited directly in SQL.';

-- Backfill any pre-existing rows (this feature set is brand new as of the
-- 20260904020000_chat_system.sql migration, so this is a no-op/near-no-op
-- safety net, not a real data migration). Mirrors the exact shape
-- lib/comments/rich-text.ts's extractPlainText produces for the only shape
-- sendMessage has ever written: docFromPlainText's `{ type: "doc", content:
-- [] }` (empty) or a single paragraph with a single text node.
update messages
set body_text = coalesce(
  body_json #>> '{content,0,content,0,text}',
  ''
)
where body_text = '';

-- Postgres full-text search index. `to_tsvector('english', body_text)` is
-- recomputed at query time (no generated column needed since body_text
-- itself is already the plain-text projection) -- EXPLAIN ANALYZE against
-- this index on a >1000-row seeded messages table is F12's acceptance
-- check that the planner picks an index scan, not a sequential scan.
create index if not exists messages_body_text_search_idx
  on messages using gin (to_tsvector('english', body_text));
