# F12 — Server actions: `lib/actions/architecture/estimates.ts`

**Status:** [CLARIFIED]
**Estimate:** 40 min
**Depends on:** F07 (schemas)

## Task

Napravi `lib/actions/architecture/estimates.ts` po tačnom obrascu `lib/actions/architecture/sections.ts`.

## Imports (kopiraj iz sections.ts, prilagodi)

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/observability/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/current-user';
import { requireActiveMembership } from '@/lib/auth/require-membership';
import { canWrite } from '@/lib/auth/permissions';
import { parseEstimateInput } from '@/lib/architecture/estimate-rollup';
import {
  setDisciplineEstimateSchema,
  clearDisciplineEstimateSchema,
  setDisciplineEstimatesBulkSchema,
} from '@/lib/validation/architecture';
import type { MutationResult } from './shared';
```

## Tri funkcije

### `setDisciplineEstimate(taskId, discipline, input, note?)`

Lanac (identičan sections.ts):
1. Zod parse `setDisciplineEstimateSchema`
2. `parseEstimateInput(input)` → ako null, vrati `{ success: false, error: 'Invalid format. Use "2h 30m", "90m", or "1.5h".' }`
3. `getCurrentUser()` → ako nema, 401
4. `createAdminClient()` — admin client bypasses RLS za lookup
5. Lookup task: `select('id, project_id, deleted_at, projects(workspace_id, workspaces(slug))')` — **project_id uvek iz DB, nikad iz payload-a**
6. Ako task ne postoji ili deleted_at nije null: `{ success: false, error: 'Not found.' }`
7. `requireActiveMembership(user.id, workspaceId)`
8. `canWrite(membership)` — ako ne može, `{ success: false, error: 'Permission denied.' }`
9. Upsert sa `on_conflict: 'task_id,discipline'`:
   ```ts
   await admin.from('task_discipline_estimates').upsert({
     task_id: taskId,
     project_id: projectId,  // iz DB, ne iz args
     discipline,
     minutes,
     note: note ?? null,
     estimated_by: user.id,
   }, { onConflict: 'task_id,discipline' });
   ```
10. `revalidatePath('/w', 'layout')` — **bez** `revalidatePortalProject` (portal ne vidi procene)
11. Vrati `{ success: true }`

### `clearDisciplineEstimate(taskId, discipline)`

Isti lanac do `canWrite`, pa:
```ts
await admin.from('task_discipline_estimates')
  .delete()
  .eq('task_id', taskId)
  .eq('discipline', discipline);
```
`revalidatePath('/w', 'layout')`

### `setDisciplineEstimatesBulk(taskId, entries)`

Isti lanac, pa `Promise.all` na niz `upsert`-ova ili jedan multi-row upsert:
```ts
const rows = entries.map(e => ({
  task_id: taskId,
  project_id: projectId,
  discipline: e.discipline,
  minutes: parseEstimateInput(e.input)!,
  note: e.note ?? null,
  estimated_by: user.id,
}));
await admin.from('task_discipline_estimates').upsert(rows, { onConflict: 'task_id,discipline' });
```
Revalidate kao gore.

## Re-export

Dodaj u barrel `lib/actions/architecture.ts`:
```ts
export { setDisciplineEstimate, clearDisciplineEstimate, setDisciplineEstimatesBulk } from './architecture/estimates';
```

## Definition of done

- [ ] `lib/actions/architecture/estimates.ts` postoji sa `'use server'`
- [ ] `project_id` uvek dolazi iz DB lookup-a task reda
- [ ] Nema `revalidatePortalProject` (portal ne vidi procene)
- [ ] Sve 3 funkcije re-exportovane iz barrel-a
- [ ] TypeScript build prolazi

## writeAudit pattern (za procene — komercijalni podaci)

Plan navodi da procene treba auditovati (nije kopiranje postojećeg obrasca, već svesno uvođenje). Ipak, za F12 auditovanje je **opcionalno** — implementiraj samo ako `writeAudit` API prima `action: string` slobodnog formata. Ako ne, ostavi TODO komentar i nastavi bez njega da ne blokiraš delivery. API izgleda ovako:
```ts
import { writeAudit } from '@/lib/activity/audit';
await writeAudit(adminClient, {
  workspaceId,
  action: 'estimate.set',
  targetType: 'task',
  targetId: taskId,
  metadata: { discipline, minutes },
});
```
