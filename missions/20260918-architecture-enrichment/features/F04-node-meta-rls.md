# F04 — RLS politike za `architecture_node_meta`

**Status:** [CLARIFIED]
**Estimate:** 25 min
**Depends on:** F03

## Task

Dodati RLS politike na kraj migracije `20261127020000_architecture_node_meta.sql`.

## Politike

Team (identično F02 pattern):
```sql
create policy architecture_node_meta_select_team on architecture_node_meta
  for select to authenticated
  using (public.is_project_visible_to(project_id) and not public.is_project_client(project_id));

create policy architecture_node_meta_insert_team on architecture_node_meta
  for insert to authenticated
  with check (public.is_project_workspace_writer(project_id));

create policy architecture_node_meta_update_team on architecture_node_meta
  for update to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

create policy architecture_node_meta_delete_team on architecture_node_meta
  for delete to authenticated
  using (public.is_project_workspace_writer(project_id));
```

Klijentska SELECT politika (4 konjunkta — intent sme jednog dana u portal):
```sql
create policy architecture_node_meta_select_client on architecture_node_meta
  for select to authenticated
  using (
    public.is_project_visible_to(project_id)
    and public.is_project_client(project_id)
    and public.is_project_portal_enabled(project_id)
    and client_visible = true
  );
```

## Definition of done

- [ ] 5 politika (4 team + 1 client SELECT)
- [ ] Klijentska politika ima sva 4 konjunkta
- [ ] `client_visible = false` (default) znači da klijent ne može pročitati red
