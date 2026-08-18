-- F100 (follow-up to F024/AS-026): close the gap flagged by M3 scrutiny.
--
-- 20260818004413_create_projects.sql only declared `name text not null`,
-- which rejects NULL but not an empty string ('') or whitespace-only
-- values. That migration's own surrounding comment incorrectly implied the
-- database already rejected an empty name server-side; in reality only the
-- application-layer Zod check (`.min(1)`) enforced that, and a direct
-- insert bypassing the Server Action (or any future bypass) could still
-- write an empty/blank name. This migration adds the missing DB-level
-- guarantee, matching the same rigor already used for
-- `projects_end_date_after_start_date`.
alter table projects
  add constraint projects_name_not_empty check (btrim(name) <> '');
