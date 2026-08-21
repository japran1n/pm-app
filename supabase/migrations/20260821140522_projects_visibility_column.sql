-- F132: projects.visibility column (AS-226, AS-227, AS-229).
--
-- Additive migration: new column, default keeps every existing project
-- exactly as visible as it is today ('workspace' — the previous, implicit,
-- only-possible behaviour), per this feature's "additive first" migration
-- safety answer.

alter table projects
  add column if not exists visibility text not null default 'workspace';

alter table projects
  add constraint projects_visibility_check
  check (visibility in ('workspace', 'private'));
