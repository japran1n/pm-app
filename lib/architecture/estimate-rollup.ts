// Mission 20260918-architecture-enrichment, F06: pure rollup functions for
// discipline-level time estimates on the architecture board.
//
// Estimates are PAGE-LEVEL ONLY. Sections no longer carry estimates, so a
// page's rollup is exactly its own per-discipline entries -- there is no
// summing across `page.sections` and no own-vs-sections precedence. (The
// old section sum also surfaced stale legacy section rows still sitting in
// the database as phantom "Σ sections" totals on pages nobody had
// estimated.) Site totals are the plain sum of those per-page numbers.
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

    const byDiscipline: Partial<Record<WorkCategory, number>> = {};
    for (const e of pageEstimates) {
      // Only the disciplines the app still knows about -- a legacy row for
      // a retired discipline must not leak into a total nothing can edit.
      if (WORK_CATEGORIES.includes(e.discipline)) {
        byDiscipline[e.discipline] = e.minutes;
      }
    }

    const total = Object.values(byDiscipline).reduce((sum, m) => sum + (m ?? 0), 0);
    const source: EstimateRollup["source"] =
      Object.keys(byDiscipline).length > 0 ? "own" : "none";

    result.set(page.id, { byDiscipline, total, source });
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
