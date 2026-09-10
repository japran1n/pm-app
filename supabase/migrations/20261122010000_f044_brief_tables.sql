-- F044: migration — four brief tables (AS-099, AS-100)
--
-- Mission 20260910-182104, milestone M6 (Brief: schema and team side).
--
-- Existing objects relied on (verified live via the Supabase Management
-- API `database/query` endpoint immediately before writing this file,
-- project qcipqonnqajmazdbysow — the MCP tool functions themselves were not
-- exposed to this worker's tool list, so the same remote-only query path
-- scripts/apply-migration.mjs uses was used instead, per F002's handoff
-- precedent):
--   * projects (20260818004413_create_projects.sql) — projects.id is uuid,
--     primary key, no existing unique brief-style column.
--   * docs (20260905010000-era migrations) — docs.id is uuid, primary key;
--     doc_kind is a text column with a CHECK, currently
--     ('note','training','process','handover'). This migration does NOT
--     touch docs_doc_kind_check — extending it with 'brief' is F047.
--   * set_updated_at() (20260818004413_create_projects.sql) — confirmed
--     live (`select proname from pg_proc where proname='set_updated_at'`)
--     as the shared `before update` trigger function every other
--     updated_at-bearing table in this schema reuses. Reused here on
--     briefs and brief_answers, the two tables in this file that carry an
--     updated_at column.
--
-- Scope for this feature only: create the four tables from the brief
-- questionnaire draft's section 4 data model. No RLS policies (F046), no
-- revision trigger (F045), no docs_doc_kind_check change (F047). RLS is
-- enabled with zero policies below, which is deny-by-default and therefore
-- the safe intermediate state until F046 lands.
--
-- brief_questions.project_id is deliberate, not a shortcut: the
-- questionnaire is per-project, never a shared workspace-level template
-- (standing-decisions.md #12). Reuse across projects travels through the
-- existing project template system in a later feature, and carries
-- QUESTIONS only, never answers.
--
-- question_prompt_snapshot on brief_answers exists so deleting a question
-- (brief_questions row) still leaves a readable answer: the FK to
-- brief_questions is `on delete set null`, and the snapshot text is what
-- the UI falls back to displaying once question_id goes null
-- (draft section 4.1).

create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects (id),
  state text not null default 'draft',
  doc_id uuid references docs (id) on delete set null,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefs_state_check check (state in ('draft', 'submitted', 'approved'))
);

-- briefs.project_id carries `unique`, which is AS-099 (a project has at
-- most one brief) enforced at the schema level, and is itself already
-- indexed by the unique constraint's backing index — no separate index
-- needed for that column.

drop trigger if exists briefs_set_updated_at on briefs;
create trigger briefs_set_updated_at
  before update on briefs
  for each row
  execute function set_updated_at();

create table if not exists brief_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  position double precision not null default 0,
  category text,
  prompt text not null,
  help_text text,
  answer_type text not null,
  options text[],
  required boolean not null default false,
  constraint brief_questions_prompt_not_empty check (btrim(prompt) <> ''),
  constraint brief_questions_answer_type_check check (
    answer_type in ('short_text', 'long_text', 'single_choice', 'multi_choice')
  )
);

-- Index strategy: index the FK/lookup column this table's RLS (F046) will
-- join through, per the migration-type convention documented in
-- 20260818040214_create_comments.sql and applied schema-wide by
-- 20261120040000_index_unindexed_foreign_keys.sql.
create index if not exists brief_questions_project_id_idx on brief_questions (project_id);

create table if not exists brief_answers (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs (id) on delete cascade,
  question_id uuid references brief_questions (id) on delete set null,
  question_prompt_snapshot text not null,
  answer_text text,
  answer_options text[],
  answered_by uuid references auth.users (id),
  answered_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint brief_answers_question_prompt_snapshot_not_empty check (
    btrim(question_prompt_snapshot) <> ''
  )
);

create index if not exists brief_answers_brief_id_idx on brief_answers (brief_id);
create index if not exists brief_answers_question_id_idx on brief_answers (question_id);

drop trigger if exists brief_answers_set_updated_at on brief_answers;
create trigger brief_answers_set_updated_at
  before update on brief_answers
  for each row
  execute function set_updated_at();

create table if not exists brief_answer_revisions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references brief_answers (id) on delete cascade,
  previous_text text,
  previous_options text[],
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

create index if not exists brief_answer_revisions_answer_id_idx on brief_answer_revisions (answer_id);

-- No changed_at trigger: this table has no updated_at column. Rows are
-- append-only writes from the revision trigger (F045); this table is
-- never updated in place.

alter table briefs enable row level security;
alter table brief_questions enable row level security;
alter table brief_answers enable row level security;
alter table brief_answer_revisions enable row level security;

-- No policies created in this migration. RLS is enabled with zero policies
-- on all four tables, which denies all access by default under RLS (no
-- FORCE ROW LEVEL SECURITY needed, matching the rest of this schema's
-- convention — the app never connects as the table owner for reads;
-- privileged server-side access goes through the secret key, which
-- bypasses RLS by design). Policies land in F046.
