-- F019 (missions/20260909-ai-docs): thread persistence.
--
-- 20261118010000's header comment states ai_messages is "appended once
-- and never edited in place" and deliberately ships no UPDATE policy.
-- F019 needs exactly one narrow exception to that: settling a proposal
-- (accept/reject) patches the `proposals` JSONB array on the message
-- that carried it, in place — this is the only way a settled decision
-- can survive a reload (AS-085: a reloaded proposal must never re-arm
-- Accept). Without this policy, `updateProposalState`
-- (lib/actions/ai-threads.ts) would execute against Postgres RLS with
-- no matching UPDATE policy — the query would run but silently affect
-- zero rows (no error surfaced), so the settled state would appear to
-- persist in the UI for the current session but be lost on the very
-- next reload. Same role gate as every other write on this table
-- (`can_write_workspace_docs`, joined through the parent thread, portal
-- clients already excluded via that predicate).

drop policy if exists ai_messages_update_via_thread on ai_messages;
create policy ai_messages_update_via_thread
  on ai_messages
  for update
  to authenticated
  using (
    exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and public.is_active_workspace_member(t.workspace_id)
        and public.can_write_workspace_docs(t.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from ai_threads t
      where t.id = ai_messages.thread_id
        and public.is_active_workspace_member(t.workspace_id)
        and public.can_write_workspace_docs(t.workspace_id)
    )
  );
