// F004 (missions/20260914-portal-simplify): shared helper so team-side
// mutations that affect client-visible portal data also revalidate the
// portal itself, not just the `/w` team routes. Pattern lifted from
// lib/actions/scope-documents.ts's `revalidateScopePage`, which already
// calls `revalidatePath(`/portal/${slug}/p/${projectId}`, "layout")`
// alongside its `/w` revalidate (AS-006).
//
// Callers should invoke this from inside their existing `revalidate*`
// helper, right alongside the `/w` revalidatePath calls, so a single
// non-fatal try/catch still covers both. Never throws.

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";

export function revalidatePortalProject(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/portal/${workspaceSlug}/p/${projectId}`, "layout");
  } catch (revalidateError) {
    logger.error("portal-revalidate: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// F004c: many call sites select a nested `workspaces(slug)` relation off a
// project/task row to feed revalidatePortalProject above without an extra
// round trip. Supabase's PostgREST client types (and sometimes returns, for
// `!inner` joins vs. plain joins) this relation as either a single object or
// a one-element array depending on the join shape, so every call site needs
// the same defensive unwrap. Centralized here instead of repeated inline.
// Returns undefined (and warns) when the slug is missing so callers can
// treat "no slug" as "skip the portal revalidate" rather than throwing.
export function extractWorkspaceSlug(
  workspaces: { slug: string } | { slug: string }[] | null | undefined,
): string | undefined {
  const row = Array.isArray(workspaces) ? workspaces[0] : workspaces;
  const slug = row?.slug;
  if (!slug) {
    logger.warn("portal-revalidate: workspace slug missing from join", {
      workspaces,
    });
    return undefined;
  }
  return slug;
}
