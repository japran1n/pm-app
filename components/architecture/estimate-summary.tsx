"use client";

import { useMemo } from "react";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, WorkCategory } from "@/lib/architecture/types";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import { computeRollups, computeSiteTotals } from "@/lib/architecture/estimate-rollup";

// UI-only restriction: content_seo, pm, and qa remain valid disciplines in
// the DB, but the summary only surfaces design and development.
const VISIBLE_DISCIPLINES: WorkCategory[] = ["design", "development"];

const DISCIPLINE_LABELS: Record<WorkCategory, string> = {
  design: "Design",
  development: "Dev",
  content_seo: "Content/SEO",
  pm: "PM",
  qa: "QA",
};

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function EstimateSummary({
  pages,
  detailsData,
}: {
  pages: BoardPage[];
  detailsData: ArchitectureNodeDetails;
}) {
  const rollups = useMemo(() => computeRollups(pages, detailsData), [pages, detailsData]);
  const siteTotals = useMemo(() => computeSiteTotals(rollups), [rollups]);

  const pagesWithEstimates = pages.filter(p => {
    const r = rollups.get(p.id);
    return r && r.source !== "none";
  });

  if (pagesWithEstimates.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          No estimates yet. Click a page&rsquo;s estimate chip to add time estimates.
        </p>
      </div>
    );
  }

  const activeDisciplines = WORK_CATEGORIES.filter(d => siteTotals[d]).filter(d =>
    VISIBLE_DISCIPLINES.includes(d)
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-xs">
      {/* Site totals row */}
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-xs font-medium text-muted-foreground">Site total</p>
        {activeDisciplines.map(d => (
          <div key={d} className="flex items-baseline gap-1">
            <span className="text-xs text-muted-foreground">{DISCIPLINE_LABELS[d]}</span>
            <span className="font-mono text-sm tabular-nums">{formatMinutes(siteTotals[d]!)}</span>
          </div>
        ))}
        {activeDisciplines.length === 0 && (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">—</span>
        )}
      </div>

      {/* Per-page table. F016 (AS-065/066): the wrapping div is the only
          element allowed to scroll horizontally -- `min-w-max` on the table
          lets all five discipline columns (F011) claim their natural width
          instead of being squeezed by `w-full`, so overflow is contained
          here and never reaches the page body. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">Page</th>
              {VISIBLE_DISCIPLINES.map(d => (
                <th key={d} className="pb-1.5 pr-3 text-xs font-medium text-muted-foreground">
                  {DISCIPLINE_LABELS[d]}
                </th>
              ))}
              <th className="pb-1.5 text-xs font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {pagesWithEstimates.map(page => {
              const rollup = rollups.get(page.id)!;
              return (
                <tr key={page.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-4 text-xs">{page.title}</td>
                  {VISIBLE_DISCIPLINES.map(d => (
                    <td key={d} className="py-1.5 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {rollup.byDiscipline[d] ? formatMinutes(rollup.byDiscipline[d]!) : "—"}
                    </td>
                  ))}
                  <td className="py-1.5 font-mono text-xs font-medium tabular-nums">
                    {formatMinutes(rollup.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
