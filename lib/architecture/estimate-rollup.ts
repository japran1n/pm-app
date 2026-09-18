// Mission 20260918-architecture-enrichment, F06: pure rollup functions for
// discipline-level time estimates on the architecture board. A page's
// "own" estimate (entered directly on the page node) always wins over the
// sum of its sections' estimates for the same discipline -- section sums
// are a fallback used only when the page has no own estimate for that
// discipline. Site totals sum only the *effective* (post-precedence)
// per-page numbers, never both own and rolled, to avoid double counting.
//
// No server/React imports -- keep this pure so it's usable from both
// server queries and client components without pulling in Supabase.

import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, EstimateRollup, WorkCategory } from "@/lib/architecture/types";
import { WORK_CATEGORIES } from "@/lib/architecture/types";

export function computeRollups(
  pages: BoardPage[],
  details: ArchitectureNodeDetails,
): Map<string, EstimateRollup> {
  const result = new Map<string, EstimateRollup>();

  for (const page of pages) {
    const pageNode = details.get(page.id);
    const pageEstimates = pageNode?.estimates ?? [];

    const own: Partial<Record<WorkCategory, number>> = {};
    for (const e of pageEstimates) {
      own[e.discipline] = e.minutes;
    }

    const sectionsByDiscipline: Partial<Record<WorkCategory, number>> = {};
    for (const section of page.sections) {
      const sectionNode = details.get(section.id);
      for (const e of sectionNode?.estimates ?? []) {
        sectionsByDiscipline[e.discipline] = (sectionsByDiscipline[e.discipline] ?? 0) + e.minutes;
      }
    }

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
    const ownTotal =
      Object.keys(own).length > 0
        ? Object.values(own).reduce((sum, m) => sum + (m ?? 0), 0)
        : null;
    const sectionsTotal = Object.values(sectionsByDiscipline).reduce((sum, m) => sum + (m ?? 0), 0);
    const source: EstimateRollup["source"] = ownTotal !== null ? "own" : total > 0 ? "rolled" : "none";

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

/**
 * Parses free-form duration input like "2h", "1h30", "1h30m", "90", "90m"
 * into minutes. Returns null when the input doesn't match a supported
 * shape.
 */
export function parseEstimateInput(input: string): number | null {
  const s = input.trim().toLowerCase();
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)\s*m?$/);
  if (hm) return Math.round(parseFloat(hm[1]) * 60 + parseInt(hm[2], 10));
  const h = s.match(/^(\d+(?:\.\d+)?)\s*h$/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const m = s.match(/^(\d+)\s*m?$/);
  if (m) return parseInt(m[1], 10);
  return null;
}
