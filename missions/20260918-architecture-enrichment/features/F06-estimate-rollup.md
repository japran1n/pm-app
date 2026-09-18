# F06 — `lib/architecture/estimate-rollup.ts` + testovi

**Status:** [CLARIFIED]
**Estimate:** 35 min

## Task

Napravi čistu (no-server, no-React) funkciju za rollup procena i njene testove.

## Tipovi (definisati u istom fajlu ili zasebnom `lib/architecture/types.ts`)

```ts
export type WorkCategory = 'design' | 'development' | 'content_seo' | 'pm' | 'qa';

export const WORK_CATEGORIES: WorkCategory[] = ['design', 'development', 'content_seo', 'pm', 'qa'];

export type DisciplineEstimate = {
  discipline: WorkCategory;
  minutes: number;
  note: string | null;
  estimatedBy: string | null; // user id
};

export type NodeMeta = {
  intent: string | null;
  audience: string | null;
  primaryCta: string | null;
  tone: string | null;
  keywords: string[];
  copyStatus: 'not_started' | 'brief_ready' | 'drafted' | 'in_review' | 'approved';
  clientVisible: boolean;
  updatedBy: string | null;
};

export type ArchitectureNodeDetails = Map<string /* taskId */, {
  estimates: DisciplineEstimate[];
  meta: NodeMeta | null;
}>;

export type EstimateRollup = {
  byDiscipline: Partial<Record<WorkCategory, number>>; // effective minutes per discipline
  total: number;                                        // sum of effective values
  source: 'own' | 'rolled' | 'none';                  // 'own' if any own estimate, 'rolled' if all from sections, 'none' if empty
  ownTotal: number | null;                             // null if no own estimates at all
  sectionsTotal: number;                               // sum of sections' own estimates (before precedence)
  conflicts: boolean;                                  // true when any discipline has BOTH own AND sections estimates with different values
};
```

## Rollup function

```ts
// lib/architecture/estimate-rollup.ts

import type { BoardPage } from '@/lib/queries/architecture';
import type { ArchitectureNodeDetails, EstimateRollup, WorkCategory } from './types';
import { WORK_CATEGORIES } from './types';

export function computeRollups(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
): Map<string /* pageId */, EstimateRollup> {
  const result = new Map<string, EstimateRollup>();

  for (const page of pages) {
    const pageNode = details.get(page.id);
    const pageEstimates = pageNode?.estimates ?? [];

    // Build own estimates map for this page
    const own: Partial<Record<WorkCategory, number>> = {};
    for (const e of pageEstimates) {
      own[e.discipline] = e.minutes;
    }

    // Sum sections' estimates per discipline
    const sectionsByDiscipline: Partial<Record<WorkCategory, number>> = {};
    for (const section of page.sections) {
      const sectionNode = details.get(section.id);
      for (const e of sectionNode?.estimates ?? []) {
        sectionsByDiscipline[e.discipline] = (sectionsByDiscipline[e.discipline] ?? 0) + e.minutes;
      }
    }

    // Apply precedence per discipline: own[d] exists ? own[d] : sectionsByDiscipline[d]
    // NEVER own + sections. conflicts = both exist AND differ.
    const byDiscipline: Partial<Record<WorkCategory, number>> = {};
    let conflicts = false;

    for (const d of WORK_CATEGORIES) {
      const o = own[d];
      const s = sectionsByDiscipline[d];
      if (o !== undefined) {
        byDiscipline[d] = o;
        if (s !== undefined && s !== o) conflicts = true;
      } else if (s !== undefined) {
        byDiscipline[d] = s;
      }
    }

    const total = Object.values(byDiscipline).reduce((sum, m) => sum + (m ?? 0), 0);
    const ownTotal = Object.keys(own).length > 0
      ? Object.values(own).reduce((sum, m) => sum + (m ?? 0), 0)
      : null;
    const sectionsTotal = Object.values(sectionsByDiscipline).reduce((sum, m) => sum + (m ?? 0), 0);

    const source: EstimateRollup['source'] =
      ownTotal !== null ? 'own' : total > 0 ? 'rolled' : 'none';

    result.set(page.id, { byDiscipline, total, source, ownTotal, sectionsTotal, conflicts });
  }

  return result;
}

export function computeSiteTotals(
  rollups: Map<string, EstimateRollup>,
): Partial<Record<WorkCategory, number>> {
  const totals: Partial<Record<WorkCategory, number>> = {};
  for (const rollup of rollups.values()) {
    for (const d of WORK_CATEGORIES) {
      const v = rollup.byDiscipline[d];
      if (v !== undefined) totals[d] = (totals[d] ?? 0) + v;
    }
  }
  return totals;
}
```

## Test file

Create `tests/unit/f006-estimate-rollup.test.ts` with these cases:

1. **precedence_own_over_sections**: page has `design=120`, section has `design=60` → effective `design=120`, `conflicts=true`, `source='own'`
2. **rolled_from_sections**: page has no own estimates, two sections with `development=30` and `development=90` → effective `development=120`, `source='rolled'`, `conflicts=false`
3. **per_discipline_mixed**: page has own `design=120`, no own `development`; section has `development=60` → `design=120` (own), `development=60` (rolled), `conflicts=false`
4. **site_total_no_double_count**: page with own `design=8h(480m)` + sections with `design=6h(360m)` → site total `design=480`, NOT 840
5. **empty**: page with no estimates and no sections → `source='none'`, `total=0`
6. **conflicts_flag_per_discipline**: own `design=120`, sections `design=100` → `conflicts=true`; own `design=120`, sections `design=120` (same value) → `conflicts=false`

## Definition of done

- [ ] `lib/architecture/estimate-rollup.ts` exists with `computeRollups` and `computeSiteTotals`
- [ ] Types exported (either from this file or from `lib/architecture/types.ts`)
- [ ] All 6 test cases pass (`npm run test tests/unit/f006-estimate-rollup.test.ts`)
- [ ] No server imports, no React imports — pure functions only
