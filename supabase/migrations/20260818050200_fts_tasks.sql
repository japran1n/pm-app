-- F068: full-text search setup on tasks (title, description).
--
-- Covers AS-117, AS-123, AS-124.
--
-- AS-117: search matches against task title and description (full-text) —
-- scoped to title+description per discovery round-2 Q13 ("matches the
-- reference app's /search endpoint scope (tasks, ... where most searchable
-- content actually is").
--
-- AS-123: to_tsvector/plainto_tsquery are inherently case-insensitive
-- (Postgres lower-cases lexemes during normalization) — no extra handling
-- needed, verified with a live query in the worker's test suite.
--
-- AS-124: title matches must outrank description-only matches. A single
-- unweighted tsvector can't express that at query time, so this column
-- stores weighted lexemes (title at weight 'A', description at weight 'B')
-- so ts_rank(search_vector, query) naturally scores title hits higher.
--
-- Generated + stored so it's always in sync with title/description and
-- doesn't need an update trigger; GIN index makes @@ lookups and ts_rank
-- computations fast.

alter table tasks
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index if not exists tasks_search_vector_idx
  on tasks using gin (search_vector);
