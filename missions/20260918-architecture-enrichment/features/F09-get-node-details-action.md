# F09 — Server Action `getNodeDetailsForToggle`

**Status:** [CLARIFIED]
**Estimate:** 20 min
**Depends on:** F08

## Task

Napravi server action koji Client Component može da pozove za fetch detalja. Pošto Client Component ne može direktno da uvozi server-only module, treba tanka obertka.

## Implementacija

Napravi `lib/actions/architecture/node-details.ts`:

```ts
'use server';

// Thin wrapper around getArchitectureNodeDetails for Client Component callers.
// A Client Component cannot import a server-only query module directly;
// a 'use server' action is the correct bridge.
//
// Permission: any active workspace member (non-client) may read estimates.
// The underlying RLS policy (task_discipline_estimates_select_team) already
// enforces this — this action adds the explicit application-level check
// as a second guard (belt and suspenders).

import { getCurrentUser } from '@/lib/auth/session';
import { requireActiveMembership } from '@/lib/auth/membership';
import { getProjectByIdForMembership } from '@/lib/queries/projects';
import { getArchitectureNodeDetails } from '@/lib/queries/architecture-details';
import type { PortalQueryResult } from '@/lib/queries/portal';
import type { ArchitectureNodeDetails } from '@/lib/architecture/types';

export async function getNodeDetailsForToggle(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureNodeDetails>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Unauthorized' };

  // Look up project to get workspace context
  const projectResult = await getProjectByIdForMembership(projectId);
  if (!projectResult.ok) return { ok: false, error: projectResult.error };

  const membership = await requireActiveMembership(user.id, projectResult.data.workspaceId);
  if (!membership.ok) return { ok: false, error: membership.error };

  // Clients may not see estimates — enforced by RLS and here explicitly
  if (membership.data.role === 'client') return { ok: false, error: 'Forbidden' };

  return getArchitectureNodeDetails(projectId);
}
```

NOTE: Check the existing action files (`lib/actions/architecture.ts` or `lib/actions/architecture/`) to find the correct imports for `getCurrentUser`, `requireActiveMembership`, etc. Mirror the exact import paths used in existing actions.

Also re-export from the barrel `lib/actions/architecture.ts` (or whichever barrel file exists).

## Definition of done

- [ ] `lib/actions/architecture/node-details.ts` exists with `'use server'`
- [ ] Auth check: user → membership → role !== 'client'
- [ ] Re-exported from barrel
- [ ] TypeScript build passes
