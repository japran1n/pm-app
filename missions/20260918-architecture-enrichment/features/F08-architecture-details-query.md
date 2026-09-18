# F08 — `lib/queries/architecture-details.ts` (novi modul, tim only)

**Status:** [CLARIFIED]
**Estimate:** 30 min

## Task

Napravi novi fajl `lib/queries/architecture-details.ts`. Ovaj fajl PORTAL NIKAD NE UVOZI — to je ključna bezbednosna garancija.

## Implementacija

```ts
// lib/queries/architecture-details.ts
//
// Mission 20260918-architecture-enrichment, F08: lazy-loaded details for the
// architecture board (discipline estimates + copy brief metadata). This module
// is team-only and is NEVER imported by any portal file. The isolation is a
// stronger guarantee than a runtime check — there is nothing to misconfigure.
//
// Three-layer protection:
//   1. task_discipline_estimates has no client SELECT RLS policy.
//   2. This module is not imported by lib/queries/portal.ts, client-board.tsx,
//      or any file under app/(portal)/**.
//   3. ClientArchitectureBoard type does not carry estimate or meta fields.
//
// Called lazily only when the "Details" toggle is enabled — the default board
// view issues the same 2 queries as before this mission (getArchitectureBoard).

import { logger } from '@/lib/observability/logger';
import { createClient } from '@/lib/supabase/server';
import type { PortalQueryResult } from '@/lib/queries/portal';
import type { ArchitectureNodeDetails, DisciplineEstimate, NodeMeta } from '@/lib/architecture/types';

export type { ArchitectureNodeDetails };

export async function getArchitectureNodeDetails(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureNodeDetails>> {
  const supabase = await createClient();

  const [estimatesResult, metaResult] = await Promise.all([
    supabase
      .from('task_discipline_estimates')
      .select('task_id, discipline, minutes, note, estimated_by')
      .eq('project_id', projectId),
    supabase
      .from('architecture_node_meta')
      .select('task_id, intent, audience, primary_cta, tone, keywords, copy_status, client_visible, updated_by')
      .eq('project_id', projectId),
  ]);

  if (estimatesResult.error) {
    logger.error('getArchitectureNodeDetails: failed to load estimates', { error: estimatesResult.error });
    return { ok: false, error: estimatesResult.error.message };
  }

  if (metaResult.error) {
    logger.error('getArchitectureNodeDetails: failed to load meta', { error: metaResult.error });
    return { ok: false, error: metaResult.error.message };
  }

  // Group estimates by task_id
  const estimatesByTask = new Map<string, DisciplineEstimate[]>();
  for (const row of estimatesResult.data ?? []) {
    const existing = estimatesByTask.get(row.task_id) ?? [];
    existing.push({
      discipline: row.discipline as DisciplineEstimate['discipline'],
      minutes: row.minutes,
      note: row.note ?? null,
      estimatedBy: row.estimated_by ?? null,
    });
    estimatesByTask.set(row.task_id, existing);
  }

  // Index meta by task_id
  const metaByTask = new Map<string, NodeMeta>();
  for (const row of metaResult.data ?? []) {
    metaByTask.set(row.task_id, {
      intent: row.intent ?? null,
      audience: row.audience ?? null,
      primaryCta: row.primary_cta ?? null,
      tone: row.tone ?? null,
      keywords: row.keywords ?? [],
      copyStatus: row.copy_status as NodeMeta['copyStatus'],
      clientVisible: row.client_visible ?? false,
      updatedBy: row.updated_by ?? null,
    });
  }

  // Merge into ArchitectureNodeDetails map
  const details: ArchitectureNodeDetails = new Map();
  const allTaskIds = new Set([...estimatesByTask.keys(), ...metaByTask.keys()]);
  for (const taskId of allTaskIds) {
    details.set(taskId, {
      estimates: estimatesByTask.get(taskId) ?? [],
      meta: metaByTask.get(taskId) ?? null,
    });
  }

  return { ok: true, data: details };
}
```

## Definition of done

- [ ] Fajl `lib/queries/architecture-details.ts` postoji
- [ ] Dva paralelna upita (`Promise.all`) — bez N+1
- [ ] Header komentar objašnjava 3-slojnu zaštitu i "NEVER imported by portal"
- [ ] `getArchitectureBoard` u `lib/queries/architecture.ts` nije izmenjen
- [ ] TypeScript build prolazi
