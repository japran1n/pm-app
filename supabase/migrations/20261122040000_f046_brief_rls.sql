-- F046: RLS across the four brief tables (AS-157, AS-158, AS-159, AS-160,
-- AS-161).
--
-- Mission 20260910-182104, milestone M6 (Brief: schema and team side).
-- Draft section 4.3 ("RLS — najosjetljiviji dio"): this is the single
-- place in the whole plan where a CLIENT WRITES to a table, and per the
-- draft's own words, "the one place in the plan that can silently leak."
--
-- Existing objects relied on (verified live via the Management API
-- `database/query` endpoint against project qcipqonnqajmazdbysow
-- immediately before writing this file — the mcp__supabase__* tool
-- functions were not exposed to this worker's tool list, same situation
-- F002/F044/F045's handoffs document; used the same remote-only query
-- path scripts/apply-migration.mjs uses):
--   * briefs, brief_questions, brief_answers, brief_answer_revisions
--     (20261122010000_f044_brief_tables.sql) — all four tables have RLS
--     enabled with ZERO policies (deny-by-default) going into this
--     migration. Confirmed live via pg_policies: 0 rows for all four
--     relnames before this file runs, except
--     brief_answer_revisions_select_project_participant added by F045
--     (20261122020000), which this migration replaces (drop + recreate,
--     tightened) rather than adding a second SELECT policy.
--   * is_project_visible_to(uuid), is_project_client(uuid),
--     is_project_workspace_writer(uuid)
--     (20260908010000_pin_pg_temp_on_client_visibility_predicates.sql) —
--     read live. is_project_client checks
--     workspace_members.role = 'client' AND status = 'active' AND project
--     match (membership + role, not membership alone).
--     is_project_workspace_writer checks active membership AND
--     `wm.role not in ('viewer', 'client')` — confirmed live this is the
--     correct AS-161 predicate: a `viewer`-role team member is excluded
--     by this function exactly like a `client` is, so reusing it here
--     (rather than inventing a parallel predicate, which the feature spec
--     explicitly forbids) is sufficient for AS-161 on brief_questions.
--   * is_project_portal_enabled(uuid)
--     (20260909010000_portal_foundations.sql) — read live:
--     `coalesce((select portal_enabled from projects where id = ...),
--     false)`.
--
-- --- the leak this repo already had, and the shape every client policy
-- --- here must avoid repeating -----------------------------------------
--
-- 20261106010000_scope_documents.sql's header documents the real bug: a
-- docs policy (20260905020000/20260905030000-era) checked project
-- MEMBERSHIP ONLY, not ROLE, so a `client` role member — who is an active
-- workspace_members row — inherited full team-shaped access. The fix
-- (20261014010000) added the missing role conjunct. Every client-facing
-- SELECT/write policy below therefore carries ALL required conjuncts
-- together: membership (is_project_visible_to or the FK join to it),
-- ROLE (is_project_client), and — because this module additionally gates
-- on the portal switch — is_project_portal_enabled. Membership alone,
-- anywhere in this file, is a bug.
--
-- The inverse trap from the same header comment also applies: every
-- team-side policy below uses is_project_workspace_writer (which already
-- excludes `client` internally) rather than is_project_visible_to alone,
-- so a client's policy path can never fall through a permissive
-- team-shaped rule.
--
-- --- the deliberate exception: brief_answers client WRITE ---------------
--
-- 20260905030000 (docs write RLS) is the schema-wide pattern for a
-- client-visible table: clients get SELECT only, every INSERT/UPDATE/
-- DELETE excludes 'client' (and 'viewer') from write entirely.
-- `brief_answers` deliberately does NOT inherit that shape. Per draft
-- section 4.3 and standing decision #13 ("Answers are editable until
-- approval. Submission is not a freeze."), the client is the primary
-- author of their own answers — this is the ONLY table in the schema
-- where a client-role session gets INSERT/UPDATE via RLS. The gate that
-- makes this safe is threefold, ANDed together on every write policy:
--   1. actor is (a portal-enabled project's client) OR a workspace writer
--   2. the project's portal_enabled is true (for the client leg only —
--      a workspace writer's access does not depend on the portal switch,
--      matching every other team-side table in this schema)
--   3. the parent brief's state is NOT 'approved' — approval freezes
--      answers for EVERYONE, including workspace writers, since
--      standing decision #16 says "Approval freezes answers, enforced in
--      RLS" with no team-only escape hatch carved out. This is also what
--      AS-148/AS-149/AS-150 (a later feature, F076) relies on: the freeze
--      is enforced here, in RLS, not in application code that a later
--      route could forget to check.
-- Per standing decision #15, brief_answers write is NOT scoped to
-- `answered_by = auth.uid()` — every client contact on the project is an
-- equal editor of the one shared brief; only the FK join to briefs via
-- is_project_client(briefs.project_id) is required. answered_by/
-- answered_at are updated by application code (not scoped by RLS to the
-- current user) so any client contact's edit still records who last
-- touched the answer.

-- ---------------------------------------------------------------------
-- briefs
-- ---------------------------------------------------------------------

-- Team: read/write, full shape, no portal gate — a brief exists and is
-- editable by the team regardless of whether the client-facing portal
-- switch is on (mirrors project_phases' team policies in
-- 20260909010000, which are also portal-gate-free for the team side).
drop policy if exists briefs_select_team on briefs;
create policy briefs_select_team
  on briefs
  for select
  to authenticated
  using (public.is_project_workspace_writer(project_id));

drop policy if exists briefs_all_team on briefs;
create policy briefs_all_team
  on briefs
  for all
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

-- Client SELECT: membership + ROLE + portal_enabled, all three
-- conjuncts, matching the corrected docs/scope-documents shape.
drop policy if exists briefs_select_client on briefs;
create policy briefs_select_client
  on briefs
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

-- Client UPDATE: the ONLY state transition a client may ever make is
-- draft -> submitted (draft section 4.3: "state mijenja klijent samo
-- draft->submitted"). The `using` clause requires the CURRENT row to be
-- 'draft' (so a client can never touch a submitted/approved brief at
-- all — not even to no-op it); the `with check` clause requires the NEW
-- row to be 'submitted' (so a client can never set any other value,
-- including flipping straight to 'approved', which per standing
-- decision #16 is an approval action, never a client action).
drop policy if exists briefs_update_client_submit on briefs;
create policy briefs_update_client_submit
  on briefs
  for update
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
    and state = 'draft'
  )
  with check (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
    and state = 'submitted'
  );

-- No client INSERT/DELETE policy: a brief row is created and deleted by
-- the team only (via briefs_all_team above); absence of a client policy
-- denies it by default under RLS.

-- ---------------------------------------------------------------------
-- brief_questions
-- ---------------------------------------------------------------------

-- Client SELECT only (AS-158's positive half, and the read half F046
-- must provide for a later feature, AS-156, to build on): the client
-- must see the questions in order to answer them. All three conjuncts.
drop policy if exists brief_questions_select_client on brief_questions;
create policy brief_questions_select_client
  on brief_questions
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

-- Team: full read/write. is_project_workspace_writer already excludes
-- both 'viewer' and 'client' (verified live, see header comment), which
-- is exactly AS-157 (no client write) and AS-161 (no viewer write) in
-- one predicate — no new predicate invented.
drop policy if exists brief_questions_select_team on brief_questions;
create policy brief_questions_select_team
  on brief_questions
  for select
  to authenticated
  using (public.is_project_workspace_writer(project_id));

drop policy if exists brief_questions_insert_team on brief_questions;
create policy brief_questions_insert_team
  on brief_questions
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists brief_questions_update_team on brief_questions;
create policy brief_questions_update_team
  on brief_questions
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists brief_questions_delete_team on brief_questions;
create policy brief_questions_delete_team
  on brief_questions
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- Deliberately no client INSERT/UPDATE/DELETE policy at all: absence
-- denies by default under RLS. This is AS-157.

-- ---------------------------------------------------------------------
-- brief_answers — THE EXCEPTION (see header comment)
-- ---------------------------------------------------------------------
-- All predicates below join brief_answers -> briefs to reach project_id
-- and briefs.state, since brief_answers itself carries neither column.

-- SELECT: team (no portal gate) OR client (membership + role + portal).
-- AS-159's positive half; the negative half (a client outside the
-- project, or a client of a portal-disabled project) is enforced by the
-- same conjuncts failing.
drop policy if exists brief_answers_select on brief_answers;
create policy brief_answers_select
  on brief_answers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      where b.id = brief_answers.brief_id
        and (
          public.is_project_workspace_writer(b.project_id)
          or (
            public.is_project_client(b.project_id)
            and public.is_project_visible_to(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
        )
    )
  );

-- INSERT/UPDATE: the client-write exception. Gate:
--   (is_project_client(pid) AND is_project_portal_enabled(pid) AND
--    is_project_visible_to(pid)) OR is_project_workspace_writer(pid)
-- ALWAYS additionally gated on briefs.state <> 'approved' — approval
-- freezes answers for every role, including the team (standing decision
-- #16, no carve-out). This is what AS-148/AS-149/AS-150 (F076) will rely
-- on. Not scoped to answered_by = auth.uid() per standing decision #15:
-- every client contact on the project is an equal editor of the one
-- shared brief.
drop policy if exists brief_answers_insert on brief_answers;
create policy brief_answers_insert
  on brief_answers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.briefs b
      where b.id = brief_answers.brief_id
        and b.state <> 'approved'
        and (
          (
            public.is_project_client(b.project_id)
            and public.is_project_visible_to(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
          or public.is_project_workspace_writer(b.project_id)
        )
    )
  );

drop policy if exists brief_answers_update on brief_answers;
create policy brief_answers_update
  on brief_answers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      where b.id = brief_answers.brief_id
        and b.state <> 'approved'
        and (
          (
            public.is_project_client(b.project_id)
            and public.is_project_visible_to(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
          or public.is_project_workspace_writer(b.project_id)
        )
    )
  )
  with check (
    exists (
      select 1
      from public.briefs b
      where b.id = brief_answers.brief_id
        and b.state <> 'approved'
        and (
          (
            public.is_project_client(b.project_id)
            and public.is_project_visible_to(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
          or public.is_project_workspace_writer(b.project_id)
        )
    )
  );

-- DELETE: team only. A client can change an answer's value but never
-- delete the row (an empty answer_text is "not answered yet", not a
-- missing row) — matches how brief_questions.answer_type governs the
-- shape, and avoids a client being able to erase question_prompt_snapshot
-- history entirely. Still additionally frozen once approved, for
-- consistency with INSERT/UPDATE above.
drop policy if exists brief_answers_delete_team on brief_answers;
create policy brief_answers_delete_team
  on brief_answers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      where b.id = brief_answers.brief_id
        and b.state <> 'approved'
        and public.is_project_workspace_writer(b.project_id)
    )
  );

-- ---------------------------------------------------------------------
-- brief_answer_revisions — tighten F045's deliberately permissive SELECT
-- ---------------------------------------------------------------------
-- F045 (20261122020000) added `brief_answer_revisions_select_project_participant`
-- with the correct shape already (workspace writer OR (client AND
-- portal enabled)) but WITHOUT the membership conjunct
-- (is_project_visible_to) on the client leg, and its own header comment
-- says the exact predicates land here. Recreated below with the missing
-- membership conjunct added, so the full three-conjunct shape (role +
-- membership + portal) matches every other client policy in this file.
-- No UPDATE or DELETE policy is added — none existed before, none is
-- added now; the table stays append-only for everyone (AS-134, AS-135,
-- already proved by F045 and unaffected by this tightening).
drop policy if exists brief_answer_revisions_select_project_participant on brief_answer_revisions;
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
            and public.is_project_visible_to(b.project_id)
            and public.is_project_portal_enabled(b.project_id)
          )
        )
    )
  );
