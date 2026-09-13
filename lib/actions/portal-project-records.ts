"use server";

// F015 (missions/20260903-portal, AS-046): the portal's own "Not correct"
// action on an unconfirmed assumption. Calls `flag_assumption_atomic`
// through the session-bound client, never the admin client — that RPC is
// SECURITY DEFINER and does its own auth.uid()-based authorization
// internally (only a client of the assumption's own project may call it;
// see that migration's own header comment), the same "RPCs that re-check
// auth.uid() internally must go through the session-bound client" rule
// `decideDeliverable`/`deliverPortalDeliverable` already follow for their
// own RPCs.
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { flagAssumptionSchema } from "@/lib/validation/project-records";
import { assertNotPreview } from "@/lib/auth/assert-not-preview";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type FlagAssumptionResult =
  | { ok: true; data: { id: string; flaggedByClientAt: string } }
  | { ok: false; error: string };

export async function flagAssumption(input: {
  assumptionId: string;
  note: string;
}): Promise<FlagAssumptionResult> {
  // F024b (AS-052): default-deny -- flagging an assumption as the client
  // is a client decision this record must not attribute to a previewer.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

  const parsed = flagAssumptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data, error } = await supabase.rpc("flag_assumption_atomic", {
    p_assumption_id: parsed.data.assumptionId,
    p_note: parsed.data.note,
  });

  if (error || !data) {
    logger.error("flagAssumption: rpc failed", { error });
    return {
      ok: false,
      error:
        error?.message?.includes("only a client of this project")
          ? "You don't have permission to flag this."
          : GENERIC_ERROR,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    logger.error("flagAssumption: rpc returned no row");
    return { ok: false, error: GENERIC_ERROR };
  }

  // Best-effort revalidation of the portal's scope view — not fatal if it
  // fails (the caller's own next fetch will still see the fresh row),
  // same non-fatal-revalidate convention every other portal action here
  // uses.
  const admin = createAdminClient();
  const { data: assumptionRow } = await admin
    .from("project_assumptions")
    .select("project_id, projects(id, workspace_id, workspaces(slug))")
    .eq("id", parsed.data.assumptionId)
    .maybeSingle();

  const project = assumptionRow?.projects as
    | { id: string; workspace_id: string; workspaces: { slug: string } | { slug: string }[] | null }
    | { id: string; workspace_id: string; workspaces: { slug: string } | { slug: string }[] | null }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspace = projectRow?.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;

  if (workspaceSlug && projectRow?.id) {
    try {
      revalidatePath(`/portal/${workspaceSlug}/p/${projectRow.id}/scope`, "page");
    } catch (revalidateError) {
      logger.error("flagAssumption: revalidatePath failed (non-fatal)", {
        error: revalidateError,
      });
    }
  }

  return {
    ok: true,
    data: { id: parsed.data.assumptionId, flaggedByClientAt: row.flagged_by_client_at as string },
  };
}
