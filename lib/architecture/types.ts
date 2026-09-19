// Mission 20260918-architecture-enrichment, F06: shared types for
// per-node estimates/meta and the rolled-up estimate shape used by
// lib/architecture/estimate-rollup.ts. Pure types, no server/React
// imports.
//
// F011 (missions/20260919-150607): WorkCategory/WORK_CATEGORIES used to be
// declared locally here with only two values ("design"/"development"),
// out of sync with the five-value vocabulary lib/validation/time-entries.ts
// and the DB CHECK constraints actually enforce. Both are now re-exported
// from there instead of redeclared, so there is exactly one WorkCategory
// type in the repo and discipline estimates can use all five categories.
import type { WorkCategory } from "@/lib/validation/time-entries";

export type { WorkCategory } from "@/lib/validation/time-entries";
export { WORK_CATEGORIES } from "@/lib/validation/time-entries";

export type DisciplineEstimate = {
  discipline: WorkCategory;
  minutes: number;
  note: string | null;
  estimatedBy: string | null;
};

export type NodeMeta = {
  intent: string | null;
  audience: string | null;
  primaryCta: string | null;
  tone: string | null;
  keywords: string[];
  copyStatus: "not_started" | "brief_ready" | "drafted" | "in_review" | "approved";
  clientVisible: boolean;
  updatedBy: string | null;
};

export type ArchitectureNodeDetails = Map<
  string,
  {
    estimates: DisciplineEstimate[];
    meta: NodeMeta | null;
  }
>;

// Estimates are page-level only (a page's own per-discipline entries).
// Sections carry no estimates, so there is nothing to sum and no
// own-vs-sections precedence to resolve: `source` is simply whether this
// page has any estimate of its own.
export type EstimateRollup = {
  byDiscipline: Partial<Record<WorkCategory, number>>;
  total: number;
  source: "own" | "none";
};
