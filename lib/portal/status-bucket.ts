import type { StatusCategory } from "@/lib/queries/portal/shared";

// The minimal `project_statuses` row shape both lookup-map builders need —
// structurally satisfied by `StatusRowWithBucket` (lib/queries/portal/
// shared.ts) and by any wider select that carries these columns.
export type StatusBucketRow = {
  id: string;
  project_id: string;
  name: string;
  category: StatusCategory;
  client_bucket: string | null;
};

export type StatusBucketMaps = {
  categoryByStatusId: Map<string, StatusCategory>;
  categoryByProjectAndName: Map<string, StatusCategory>;
  // F006g (missions/20260903-portal, AS-015): carried the same way as
  // category, so `PortalTaskList`'s group headings (and the Overview's
  // "waiting" predicate) can resolve a bucket via `resolveClientBucket`
  // instead of matching the status's name.
  clientBucketByStatusId: Map<string, string | null>;
  clientBucketByProjectAndName: Map<string, string | null>;
};

// One construction of the status-id → category / client_bucket lookup
// maps, shared by `getPortalProjects` and `getPortalOverview` (which
// previously each built their own, identical copy). The
// `<project_id>:<name>` keys serve the "status_id not yet backfilled"
// fallback path; callers that only ever match by id simply ignore those
// two maps.
export function buildStatusBucketMaps(
  statuses: readonly StatusBucketRow[],
): StatusBucketMaps {
  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByProjectAndName = new Map<string, StatusCategory>();
  const clientBucketByStatusId = new Map<string, string | null>();
  const clientBucketByProjectAndName = new Map<string, string | null>();
  for (const status of statuses) {
    categoryByStatusId.set(status.id, status.category);
    categoryByProjectAndName.set(`${status.project_id}:${status.name}`, status.category);
    clientBucketByStatusId.set(status.id, status.client_bucket ?? null);
    clientBucketByProjectAndName.set(`${status.project_id}:${status.name}`, status.client_bucket ?? null);
  }
  return {
    categoryByStatusId,
    categoryByProjectAndName,
    clientBucketByStatusId,
    clientBucketByProjectAndName,
  };
}
