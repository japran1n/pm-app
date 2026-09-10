-- Mission 20260910-182104, F047: Migration — brief document kind.
--
-- Widens `docs_doc_kind_check` to also accept 'brief', so "Create brief"
-- (F048+) can store the generated document as a normal `docs` row (AS-142)
-- instead of a new table — same "extend the vocabulary rather than
-- duplicate it" shape F114 (20261102010000) used for onboarding/feedback/
-- portal_guide, and the shape F044's own header comment
-- (20261122010000_f044_brief_tables.sql) explicitly deferred to this
-- feature ("extending it with 'brief' is F047").
--
-- Verified immediately before writing this file, via the Supabase
-- Management API `database/query` endpoint (this repo's remote-only
-- workflow — see scripts/apply-migration.mjs; no `mcp__supabase__*` tool
-- functions were exposed in this worker's tool list, matching F002's and
-- F044's own documented fallback) against project qcipqonnqajmazdbysow:
--
--   select conname, pg_get_constraintdef(oid) as def
--   from pg_constraint where conname = 'docs_doc_kind_check';
--
-- returned:
--
--   CHECK ((doc_kind = ANY (ARRAY['note'::text, 'training'::text,
--   'process'::text, 'handover'::text, 'onboarding'::text,
--   'feedback'::text, 'portal_guide'::text])))
--
-- i.e. seven values live today (F022's original four plus F114's three),
-- NOT the four ('note','training','process','handover') recorded in
-- missions/drafts/brief-questionnaire.md section 4 — that draft predates
-- F114. The live constraint wins: every one of the seven values above is
-- preserved here, with 'brief' appended as the eighth. Dropping any of
-- them would break existing docs rows already using onboarding/feedback/
-- portal_guide.

alter table docs
  drop constraint if exists docs_doc_kind_check,
  add constraint docs_doc_kind_check check (
    doc_kind in (
      'note', 'training', 'process', 'handover',
      'onboarding', 'feedback', 'portal_guide',
      'brief'
    )
  );
