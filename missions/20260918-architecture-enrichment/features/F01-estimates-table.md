# F01 — `task_discipline_estimates` tabela + indeksi + triger

**Status:** [CLARIFIED]
**Estimate:** 30 min

## Task

Napravi migraciju `supabase/migrations/20261127010000_architecture_discipline_estimates.sql`.

## Header komentar (obavezan, dugačak)

Objasni u header komentaru:
- PK `(task_id, discipline)` umesto surrogate id: "jedna procena po disciplini po čvoru" je cel invarijant; surrogate bi dozvolio dva `design` reda i učinio rollup neodgovorivim. Upsert ide kao `on conflict (task_id, discipline)`.
- `discipline` ponavlja `work_category` vokabular doslovno (literalni CHECK, ne shared enum) — ista konvencija kao `time_entries_work_category_check` u `20261010010000`. Jednakost `discipline = work_category` nosi poređenje procene sa stvarnim.
- `project_id` denormalizovan (ne izvodi se kroz tasks join) — RLS direktan predikat bez podupita, projektni zbir jedan upit bez join-a. Upis uvek izvodi project_id iz pronađenog task reda na serveru, nikad iz payload-a.
- Nema trigera koji sinhronizuje `tasks.estimate_minutes` — svesna odluka.

## SQL

```sql
create table if not exists task_discipline_estimates (
  task_id      uuid not null references tasks (id) on delete cascade,
  project_id   uuid not null references projects (id) on delete cascade,
  discipline   text not null check (discipline in ('design','development','content_seo','pm','qa')),
  minutes      integer not null check (minutes > 0),
  note         text,
  estimated_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (task_id, discipline)
);

create index if not exists task_discipline_estimates_project_id_idx
  on task_discipline_estimates (project_id);
create index if not exists task_discipline_estimates_project_discipline_idx
  on task_discipline_estimates (project_id, discipline);
```

Dodati trigger `set_updated_at` po obrascu `page_components` migracije:
```sql
create trigger set_updated_at
  before update on task_discipline_estimates
  for each row execute procedure moddatetime(updated_at);
```
(ako `moddatetime` nije dostupan, koristi `set_updated_at` funkciju koja postoji u repo-u — proveri sa `\df set_updated_at`)

## RLS

**Samo enable, bez politika** — politike idu u F02.

```sql
alter table task_discipline_estimates enable row level security;
```

## Definition of done

- [ ] Migracija postoji na tačnoj putanji
- [ ] `primary key (task_id, discipline)` — PK je kompozitni, ne surrogate
- [ ] `check (discipline in ('design','development','content_seo','pm','qa'))` postoji
- [ ] `check (minutes > 0)` postoji
- [ ] Oba indeksa kreirana
- [ ] `updated_at` trigger postoji
- [ ] `alter table ... enable row level security` postoji
- [ ] Migracija prolazi `supabase db push --dry-run` (ili ekvivalent)
- [ ] Header komentar objašnjava sve 4 tačke gore
