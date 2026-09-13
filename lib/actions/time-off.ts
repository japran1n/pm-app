"use server";

// Team PTO calendar: create/delete Server Actions (see
// supabase/migrations/20261114010000_time_off_entries.sql for the data
// model and RLS this file's checks intentionally re-verify). Mirrors
// lib/actions/calendar-blocks.ts's own "session client performs the real
// write, the checks above turn a bare RLS rejection into a specific,
// friendly message" convention.
//
// Create is always for the caller themselves (user_id = auth.uid()) --
// there is no "create PTO on someone else's behalf" path in this
// feature's spec. Delete is owner-or-workspace-admin, matching
// `time_off_entries_delete_own_or_admin`'s RLS floor.

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { createTimeOffSchema, deleteTimeOffSchema } from "@/lib/validation/time-off";
import { logger } from "@/lib/observability/logger";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const NOT_FOUND_ERROR = "Time off entry not found.";
const PERMISSION_DENIED_ERROR = "You don't have permission to manage this time off entry.";

export type TimeOffEntryResult =
  | {
      ok: true;
      data: {
        id: string;
        workspaceId: string;
        userId: string;
        startDate: string;
        endDate: string;
        note: string | null;
      };
    }
  | { ok: false; error: string };

const SELECT_COLUMNS = "id, workspace_id, user_id, start_date, end_date, note";

async function revalidateCalendarRoutes(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
) {
  try {
    const { data: workspaceRow } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceRow?.slug) {
      revalidatePath(`/w/${workspaceRow.slug}/calendar`);
    }
  } catch (revalidateError) {
    logger.error("time-off: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// Create a PTO entry for the signed-in caller.
export async function createTimeOff(input: unknown): Promise<TimeOffEntryResult> {
  const parsed = createTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid time off entry." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to add time off." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, parsed.data.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: PERMISSION_DENIED_ERROR };
  }

  // The session-scoped client performs the real write --
  // `time_off_entries_insert_own` already enforces `user_id = auth.uid()`
  // plus active membership; the checks above just turn a bare RLS
  // rejection into a specific message.
  const { data: inserted, error: insertError } = await supabase
    .from("time_off_entries")
    .insert({
      workspace_id: parsed.data.workspaceId,
      user_id: user.id,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      note: parsed.data.note?.trim() || null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (insertError || !inserted) {
    logger.error("createTimeOff: insert failed", { error: insertError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateCalendarRoutes(admin, parsed.data.workspaceId);

  return {
    ok: true,
    data: {
      id: inserted.id,
      workspaceId: inserted.workspace_id,
      userId: inserted.user_id,
      startDate: inserted.start_date,
      endDate: inserted.end_date,
      note: inserted.note,
    },
  };
}

export type DeleteTimeOffResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

// Delete a PTO entry -- its own owner, or an owner/admin of the
// workspace, per `time_off_entries_delete_own_or_admin`.
export async function deleteTimeOff(input: unknown): Promise<DeleteTimeOffResult> {
  const parsed = deleteTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid time off entry." };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage time off." };
  }

  const admin = createAdminClient();
  const { data: entry, error: loadError } = await admin
    .from("time_off_entries")
    .select("id, workspace_id, user_id")
    .eq("id", parsed.data.entryId)
    .maybeSingle();

  if (loadError || !entry) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }

  const isOwner = entry.user_id === user.id;
  if (!isOwner) {
    const membership = await requireActiveMembership(admin, entry.workspace_id, user.id);
    const isAdmin = membership.ok && (membership.role === "owner" || membership.role === "admin");
    if (!isAdmin) {
      return { ok: false, error: PERMISSION_DENIED_ERROR };
    }
  }

  // The session-scoped client performs the real write -- RLS
  // (`time_off_entries_delete_own_or_admin`) re-verifies the same
  // owner-or-admin rule independently.
  const { error: deleteError } = await supabase
    .from("time_off_entries")
    .delete()
    .eq("id", entry.id);

  if (deleteError) {
    logger.error("deleteTimeOff: delete failed", { error: deleteError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateCalendarRoutes(admin, entry.workspace_id);

  return { ok: true, data: { id: entry.id } };
}
