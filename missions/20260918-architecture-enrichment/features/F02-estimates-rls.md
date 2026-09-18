# F02 — RLS politike za `task_discipline_estimates`

**Status:** [CLARIFIED]
**Estimate:** 30 min
**Depends on:** F01

## Task

Dodati RLS politike na kraj iste migracije `20261127010000_architecture_discipline_estimates.sql` (iza `enable row level security`).

## Politike

Po obrascu `page_components` politika ([supabase/migrations/20261121020000_f003_page_components_rls.sql:40-66]):

```sql
-- Team SELECT: authenticated + projekat vidljiv + nije klijent
create policy task_discipline_estimates_select_team on task_discipline_estimates
  for select to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

-- INSERT
create policy task_discipline_estimates_insert_team on task_discipline_estimates
  for insert to authenticated
  with check (public.is_project_workspace_writer(project_id));

-- UPDATE
create policy task_discipline_estimates_update_team on task_discipline_estimates
  for update to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

-- DELETE
create policy task_discipline_estimates_delete_team on task_discipline_estimates
  for delete to authenticated
  using (public.is_project_workspace_writer(project_id));
```

**NEMA klijentske SELECT politike** — ovo je pravilo, ne propust. Mora biti eksplicitno napisano u komentaru iznad politika:
```sql
-- No client SELECT policy is intentional: discipline estimates are commercial
-- data and must never be visible to portal clients. The absence is the rule,
-- not an oversight — see plan §1.1 and the three-layer protection comment in
-- lib/queries/architecture-details.ts (when created).
```

## Definition of done

- [ ] 4 politike postoje (select, insert, update, delete) — sve team-only
- [ ] Komentar eksplicitno objašnjava odsustvo klijentske SELECT politike
- [ ] SELECT politika koristi `is_project_visible_to AND NOT is_project_client`
- [ ] Write politike koriste `is_project_workspace_writer`
- [ ] Direktan SQL test kao `service_role`: `select count(*) from task_discipline_estimates` vraća broj redova
- [ ] Direktan SQL test kao `anon`: query vraća RLS grešku ili 0 redova
