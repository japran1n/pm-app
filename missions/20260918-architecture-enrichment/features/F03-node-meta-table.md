# F03 — `architecture_node_meta` tabela + indeksi + triger

**Status:** [CLARIFIED]
**Estimate:** 30 min

## Task

Napravi migraciju `supabase/migrations/20261127020000_architecture_node_meta.sql`.

## Razlog za zasebnu tabelu (obavezan u header komentaru)

1. `tasks` već nosi 5+ arhitekturnih kolona; još 6 bi značilo da je većina reda arhitekturna za ~1% taskova.
2. Polja su retka — običan task bi nosio 6 trajnih NULL-ova.
3. **Odvojivost je bezbednosno svojstvo**: portalski upit prosto ne bira ovu tabelu, dok bi kolona na `tasks` putovala unutar deljenog `TASK_COLUMNS` (isti §D.1 propust kao `page_components` audit).

## SQL

```sql
create table if not exists architecture_node_meta (
  task_id        uuid primary key references tasks (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  intent         text,
  audience       text,
  primary_cta    text,
  tone           text,
  keywords       text[] not null default '{}',
  copy_status    text not null default 'not_started'
    check (copy_status in ('not_started','brief_ready','drafted','in_review','approved')),
  client_visible boolean not null default false,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint architecture_node_meta_keywords_bounded
    check (array_length(keywords, 1) is null or array_length(keywords, 1) <= 30)
);

create index if not exists architecture_node_meta_project_id_idx
  on architecture_node_meta (project_id);
create index if not exists architecture_node_meta_keywords_gin
  on architecture_node_meta using gin (keywords);
```

Dodati trigger `set_updated_at` isti kao F01.

## RLS

Samo enable u ovoj migraciji, politike u F04:
```sql
alter table architecture_node_meta enable row level security;
```

## Definition of done

- [ ] Migracija na tačnoj putanji
- [ ] `task_id uuid primary key` (1:1 sa tasks)
- [ ] `copy_status` CHECK sa 5 vrednosti
- [ ] `keywords text[] not null default '{}'` sa bounded CHECK (max 30)
- [ ] GIN indeks na keywords
- [ ] `updated_at` trigger
- [ ] `enable row level security`
- [ ] Header komentar sa 3 razloga za zasebnu tabelu
