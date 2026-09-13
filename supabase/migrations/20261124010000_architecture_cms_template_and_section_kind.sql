-- Architecture canvas: distinguish a CMS *template* from a CMS listing, and
-- give sections a kind of their own.
--
-- The old `page_kind = 'cms'` conflated two different things. On a real site
-- (goodguys.se, the reference used to build this out) `/webflow-blogg` is an
-- ordinary page that happens to render a collection list, while
-- `/webflow-blogg/<slug>` is a single template standing in for every post.
-- Modelling each post as its own page is what makes a sitemap unreadable, so:
--
--   static        a normal page
--   cms_template  one node representing every item of a collection
--   cms           retained: an existing page already marked as CMS-driven
--   utility       404, thank-you, and friends
--
-- `section_kind` carries the same distinction one level down. A section is
-- already able to point at a reusable component (`component_id`); what it
-- could not say is whether its content is static or comes from a collection.
-- That is how a listing page is expressed: an ordinary page holding one
-- section whose kind is 'cms'. `component_id` stays orthogonal -- a section
-- can be both CMS-driven and rendered by a shared component.
alter table public.tasks drop constraint if exists tasks_page_kind_check;
alter table public.tasks add constraint tasks_page_kind_check check (
  page_kind is null or page_kind in ('static', 'cms', 'cms_template', 'utility')
);

comment on constraint tasks_page_kind_check on public.tasks is
  'Architecture page kinds. Widened from static/cms/utility to add cms_template -- a single node standing in for every item of a collection, as opposed to a listing page (an ordinary page with a section_kind = ''cms'' section).';

alter table public.tasks
  add column if not exists section_kind text not null default 'static';

alter table public.tasks drop constraint if exists tasks_section_kind_check;
alter table public.tasks add constraint tasks_section_kind_check check (
  section_kind in ('static', 'cms')
);

comment on column public.tasks.section_kind is
  'Architecture section content source: ''static'' (fixed content) or ''cms'' (rendered from a collection). Orthogonal to component_id, which says which shared component renders it. Only meaningful on section rows (parent_task_id is not null); page rows keep the default.';
