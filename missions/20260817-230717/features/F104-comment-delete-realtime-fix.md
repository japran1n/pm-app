# F104: comment delete realtime fix

**Milestone:** M6 — List/search/comments/attachments (follow-up)
**Estimated worker time:** 30 minutes
**Depends on:** F062
**Parent:** F062

## Assertion IDs covered
- AS-101

## Draft scope
- scrutiny-validator (M6-scrutiny.md) confirmed a real bug: Supabase Realtime's `postgres_changes` evaluates the SELECT RLS policy against the NEW row for UPDATE events. `deleteComment`'s soft-delete sets `deleted_at`, and `comments_select_active_members`'s RLS policy filters `deleted_at is null` — so the new (soft-deleted) row fails its own SELECT policy, and Realtime silently drops the delete event for EVERY subscriber, not just the deleter. A comment doesn't disappear from other viewers' live view until they reload (AS-102 still holds on reload; only the live-propagation half, AS-101, is broken).
- Fix: switch the delete-notification path from postgres_changes to Realtime Broadcast, sent explicitly from deleteComment after a successful soft-delete: `supabase.channel('comments:' + taskId).send({ type: 'broadcast', event: 'comment_deleted', payload: { id: commentId } })`. Keep postgres_changes for INSERT (new comments, unaffected — AS-103 already works since inserted rows pass RLS). Update use-comments-realtime.ts to listen for both the postgres_changes INSERT channel and the new broadcast event, removing a comment from local state on the broadcast.
- Note: broadcast doesn't have RLS built in the same way — since the channel name embeds task_id and the client only subscribes to channels for tasks they can already see (gated by the page/component only rendering for RLS-visible tasks), this is acceptable, but document the reasoning explicitly, since broadcast messages aren't RLS-gated at the transport level the way postgres_changes are.
- Add an integration test proving a comment deleted by one user is observed by a second concurrent subscriber (as close to real two-client Realtime as the test harness allows) — the existing unit test only proves the reducer is correct given a synthetic payload, not that Postgres/Realtime ever produces that payload under RLS.

## Files (approximate)
lib/actions/comments.ts, lib/tasks/subscribe-comments-realtime.ts, components/task/use-comments-realtime.ts (or wherever F062 put it), tests

## Notes for clarification
Source: M6-scrutiny.md summary + AS-101 row. Severity: high (confirmed broken, not speculative).
