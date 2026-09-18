// Mission 20260918-architecture-enrichment, F06: shared types for
// per-node estimates/meta and the rolled-up estimate shape used by
// lib/architecture/estimate-rollup.ts. Pure types, no server/React
// imports.

export type WorkCategory = "design" | "development" | "content_seo" | "pm" | "qa";

export const WORK_CATEGORIES: WorkCategory[] = [
  "design",
  "development",
  "content_seo",
  "pm",
  "qa",
];

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

export type EstimateRollup = {
  byDiscipline: Partial<Record<WorkCategory, number>>;
  total: number;
  source: "own" | "rolled" | "none";
  ownTotal: number | null;
  sectionsTotal: number;
  conflicts: boolean;
};
