-- F005 (missions/20260909-ai-docs, AS-024/AS-002/AS-028): widen
-- `task_templates.kind` to also allow 'doc'.
--
-- F181's original migration (supabase/migrations/20260822180000_task_templates.sql)
-- deliberately chose one table with a `kind` discriminator over a table per
-- kind, and its header comment says exactly why a third kind should never
-- need a new table: every kind shares the same columns (id, workspace_id,
-- name, payload, created_by, created_at) and the same RLS shape
-- (workspace-scoped, non-guest SELECT, creator-or-admin/owner
-- INSERT/UPDATE/DELETE), and `payload` is opaque jsonb whose shape is
-- allowed to differ per kind without any relational column ever needing to
-- be added or removed. That reasoning was written anticipating exactly this
-- situation: F184 already extended `kind` from a hardcoded pair to
-- `('task', 'project')` inside the same migration rather than adding a
-- second table, and this migration extends it again to add `'doc'` for the
-- ai-docs mission's document-drafting templates (list_doc_templates,
-- F005) — a document template's payload
-- (`{ sections: string[]; rules: string[]; tone?: string; folderHint?: string }`,
-- lib/validation/templates.ts's `docTemplatePayloadSchema`) is just as
-- opaque to the DB as the task and project payloads already are, so the
-- same split applies unchanged: the DB enforces storage + workspace access
-- control via RLS, and payload SHAPE is validated by Zod at the Server
-- Action layer (F182's precedent), never by a DB CHECK. No RLS policy,
-- index, or column changes are needed for this third kind — they were
-- already written generically over `kind` (see e.g.
-- `task_templates_workspace_id_kind_idx`, which already covers any value
-- of `kind` including this new one) and require no edits here.
--
-- This ALTER widens the existing CHECK constraint in place rather than
-- dropping and recreating the table, per this feature's explicit
-- instruction — the constraint is dropped and immediately re-added with
-- the widened value list under the same semantics (NOT NULL / default
-- 'task' are untouched).

alter table public.task_templates
  drop constraint task_templates_kind_check;

alter table public.task_templates
  add constraint task_templates_kind_check
  check (kind in ('task', 'project', 'doc'));

comment on table public.task_templates is
  'Reusable templates a workspace member can save and re-apply. kind=''task'' payload mirrors lib/recurrence/clone-fields.ts''s cloneTaskFields shape (title, description, description_json, priority, checklistItems, estimate_minutes, tags) restricted to the same field allow-list F180''s duplicate-task uses, so a template can never carry comments or attachments (F181, AS-328). kind=''project'' payload (F184) holds a project''s columns + an ordered task list. kind=''doc'' payload (F005, missions/20260909-ai-docs) holds a document-drafting template: { sections: string[]; rules: string[]; tone?: string; folderHint?: string }, read by the list_doc_templates AI tool and validated by lib/validation/templates.ts''s docTemplatePayloadSchema — not produced or consumed by this migration.';
comment on column public.task_templates.kind is
  'Discriminator: ''task'' (F181/F182), ''project'' (F184), or ''doc'' (F005, missions/20260909-ai-docs). Single table, not one per kind, per this migration''s original header note — shared RLS shape, shared columns, opaque jsonb payload for every kind.';
