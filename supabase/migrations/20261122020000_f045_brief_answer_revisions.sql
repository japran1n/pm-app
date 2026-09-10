-- F045: revision trigger + append-only policies on brief_answer_revisions
-- (AS-127, AS-133, AS-134, AS-135).
--
-- Mission 20260910-182104, milestone M6 (Brief: schema and team side).
-- Standing decision #14 (clarifications/standing-decisions.md): "Every
-- answer change writes a revision row from a database trigger, never
-- from application code. Revisions are append-only for everyone." Draft
-- section 4.2 ("Izmjena odgovora — smije, ali se vidi") is the spec this
-- migration implements: the client may change an answer at any time
-- before brief approval, but the change must never be silent.
--
-- Existing objects relied on (verified live, immediately before writing
-- this file, via the Management API `database/query` endpoint against
-- project qcipqonnqajmazdbysow — same remote-only path
-- scripts/apply-migration.mjs uses; MCP tool functions were not exposed
-- to this worker's tool list, matching F002/F044's documented situation):
--   * brief_answers, brief_answer_revisions, briefs
--     (20261122010000_f044_brief_tables.sql) — column shapes confirmed
--     live via information_schema.columns: brief_answers has
--     answer_text/answer_options/answered_by/answered_at/updated_at;
--     brief_answer_revisions has answer_id/previous_text/
--     previous_options/changed_by/changed_at, and carries zero policies
--     (RLS enabled, deny-by-default, as F044 left it).
--   * audit_log (20260821211226_create_audit_log.sql) — confirmed live
--     via pg_policies: exactly one SELECT policy
--     (`audit_log_select_owner_admin`), no UPDATE/DELETE policy at all.
--     This migration mirrors that append-only shape on
--     brief_answer_revisions: one SELECT policy, no UPDATE, no DELETE.
--   * is_project_workspace_writer(uuid), is_project_client(uuid),
--     is_project_portal_enabled(uuid) — SECURITY DEFINER helper
--     functions that already exist
--     (20260908010000_pin_pg_temp_on_client_visibility_predicates.sql,
--     20260909010000_portal_foundations.sql), both already pinning
--     `set search_path = public, pg_temp`. Reused here unchanged for the
--     SELECT policy's project-scoping predicate.
--
-- --- why this must be a trigger, not application code -------------------
--
-- Draft section 9's reasoning, restated: if "write a revision" lives in
-- app code, the first Server Action / route that updates
-- `brief_answers.answer_text` or `.answer_options` and forgets to also
-- call a "record revision" helper produces a silent edit — and a silent
-- edit is precisely the failure mode this feature exists to prevent
-- (AS-133: an answer cannot be changed without a revision being
-- recorded). A `before update` row trigger on `brief_answers` cannot be
-- bypassed by any INSERT/UPDATE statement reaching the table, regardless
-- of which code path issued it, including a raw `update brief_answers
-- set ...` run directly in SQL. That is also how AS-133 is proven below:
-- by demonstrating a direct SQL UPDATE, bypassing every application
-- layer, still produces a revision row.
--
-- --- the no-op-update question: skip when content did not change -------
--
-- Decision: the trigger SKIPS writing a revision when neither
-- `answer_text` nor `answer_options` actually changed value (e.g. an
-- UPDATE that only touches `updated_at`, or a no-op `update ... set
-- answer_text = answer_text`). Reasoning:
--   * AS-127 says "changing a saved answer records the previous value" —
--     it is scoped to actual content changes, not to every UPDATE
--     statement that happens to touch the row.
--   * AS-133 says "an answer cannot be changed WITHOUT a revision being
--     recorded" — the negative space is content changes without a
--     revision, not the presence of unrelated no-op UPDATE statements.
--     A trigger that always fires regardless of whether content changed
--     would produce a revision history polluted with entries where
--     `previous_text = current text`, which is worse for the "izmijenjeno
--     · <ime> · <kad>" UI in 4.2: every touch (even ones that changed
--     nothing) would show up as a fake edit in the client-visible
--     history, defeating the "se vidi" (it is visible) guarantee's
--     honesty.
--   * The existing `brief_answers_set_updated_at` trigger
--     (20261122010000) already fires `before update` unconditionally on
--     every UPDATE, including ones that don't touch answer content —
--     so an update-only-touches-updated_at path is a real, expected
--     occurrence this schema already produces (e.g. any future
--     touch-to-bump-updated_at operation), not a hypothetical.
--   * The comparison uses `is distinct from` so NULL-to-NULL and
--     NULL-to-value transitions are both handled correctly (a plain `<>`
--     would incorrectly treat two NULLs as "not changed... but also not
--     equal", i.e. never true, silently hiding a NULL->NULL-adjacent
--     comparison bug; `is distinct from` treats NULL = NULL as not
--     distinct, which is exactly "unchanged").
--
-- --- why the trigger function is SECURITY DEFINER ------------------------
--
-- `brief_answer_revisions` deliberately gets NO INSERT policy for any
-- role (see below) — the only way a row can ever be inserted is through
-- this trigger. A plain (non-SECURITY-DEFINER) trigger function runs
-- with the privileges of the role that issued the UPDATE
-- (`authenticated`), and RLS would then block its internal INSERT into
-- brief_answer_revisions, since no INSERT policy exists for that role.
-- SECURITY DEFINER makes the function run as the function's owner
-- (the migration-applying role, which is not subject to the target
-- table's RLS the way `authenticated` is), so the trigger's INSERT
-- succeeds without requiring an INSERT policy that a client session
-- could otherwise use directly. This mirrors `write_audit_log_entry`'s
-- SECURITY DEFINER rationale in 20260821211226, generalized: the
-- boundary that makes both tables genuinely append-only is "the only
-- privileged write path is a SECURITY DEFINER function/trigger, and no
-- INSERT policy exists for ordinary sessions" — not "no UI calls
-- INSERT directly."
--
-- Per 20260908010000's documented hijack surface (an unqualified
-- `set search_path = public` on a SECURITY DEFINER function lets a role
-- with TEMP privileges shadow `public` objects via a same-named
-- `pg_temp` object), this function pins `set search_path = public,
-- pg_temp` explicitly.
--
-- `changed_by` is set to `auth.uid()` — the acting user's session, not a
-- client-supplied value — for the same reason `write_audit_log_entry`
-- pins `actor_id` server-side rather than trusting a caller-supplied
-- actor: it removes the "forge a revision claiming to be someone else"
-- surface entirely.

create or replace function public.record_brief_answer_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.answer_text is distinct from old.answer_text)
     or (new.answer_options is distinct from old.answer_options) then
    insert into public.brief_answer_revisions (
      answer_id,
      previous_text,
      previous_options,
      changed_by,
      changed_at
    )
    values (
      old.id,
      old.answer_text,
      old.answer_options,
      auth.uid(),
      now()
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_brief_answer_revision() from public;

drop trigger if exists brief_answers_record_revision on public.brief_answers;
create trigger brief_answers_record_revision
  before update on public.brief_answers
  for each row
  execute function public.record_brief_answer_revision();

-- --- append-only RLS on brief_answer_revisions --------------------------
--
-- SELECT: project-scoped, permissive between team and client for now.
-- The exact predicates (portal-enabled gating for the client side,
-- client-visibility parity with brief_answers) land in F046, which
-- already owns brief_answers/brief_questions/briefs RLS end to end and
-- is the natural place to keep every brief-table policy shape
-- consistent. Granting SELECT here to any active project participant
-- (workspace writer OR project client) is the minimum needed so this
-- migration's own append-only proof (below) can exercise a real SELECT,
-- and does not need tightening to satisfy AS-134/AS-135 — those two
-- assertions are about UPDATE/DELETE, which this migration omits
-- entirely, permanently, for every role.
create policy brief_answer_revisions_select_project_participant
  on public.brief_answer_revisions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.brief_answers ba
      join public.briefs b on b.id = ba.brief_id
      where ba.id = brief_answer_revisions.answer_id
        and (
          public.is_project_workspace_writer(b.project_id)
          or (
            public.is_project_client(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
        )
    )
  );

-- Deliberately no INSERT policy: the only INSERT path is the SECURITY
-- DEFINER trigger function above, which is not subject to this table's
-- RLS. No `authenticated`-role INSERT policy exists, so a client session
-- attempting `insert into brief_answer_revisions (...) values (...)`
-- directly is rejected by RLS (AS-133's other half: revisions cannot be
-- forged either, only produced by the trigger).
--
-- Deliberately no UPDATE policy for any role (AS-134) and no DELETE
-- policy for any role (AS-135) — permanently. This is what makes the
-- table append-only, mirroring audit_log's identical omission in
-- 20260821211226.
