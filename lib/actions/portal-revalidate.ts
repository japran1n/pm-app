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
