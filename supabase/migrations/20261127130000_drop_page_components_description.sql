-- F032: page_components.description has 0 non-null rows (confirmed by F031); safe to drop.
alter table public.page_components
  drop column if exists description;
