"use server";
import { logger } from "@/lib/observability/logger";

// Quick notes: a lighter, smaller entity than a personal to-do or task —
// no title/status/priority, just a short "don't forget" reminder,
// optionally pinned to a task or project for context. Owner-only, same
// `quick_notes_owner_only` RLS enforcement boundary as personal_todos (no
// membership/admin branch) — every action still runs through the
// request-scoped RLS-respecting client, never the admin client.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  createQuickNoteSchema,
  toggleQuickNoteSchema,
  deleteQuickNoteSchema,
} from "@/lib/validation/quick-notes";
import { getMyQuickNotes, type QuickNote } from "@/lib/queries/quick-notes";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type QuickNoteActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createQuickNote(
  input: unknown,
): Promise<QuickNoteActionResult> {
  const parsed = createQuickNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: GENERIC_ERROR };

  const { error } = await supabase.from("quick_notes").insert({
    user_id: user.id,
    workspace_id: parsed.data.workspaceId,
    text: parsed.data.text,
    task_id: parsed.data.taskId ?? null,
    project_id: parsed.data.projectId ?? null,
  });

  if (error) {
    logger.error("createQuickNote failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]", "page");
  return { ok: true };
}

export async function toggleQuickNote(
  input: unknown,
): Promise<QuickNoteActionResult> {
  const parsed = toggleQuickNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_notes")
    .update({
      is_done: parsed.data.isDone,
      completed_at: parsed.data.isDone ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.noteId);

  if (error) {
    logger.error("toggleQuickNote failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]", "page");
  return { ok: true };
}

export async function deleteQuickNote(
  input: unknown,
): Promise<QuickNoteActionResult> {
  const parsed = deleteQuickNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("quick_notes")
    .delete()
    .eq("id", parsed.data.noteId);

  if (error) {
    logger.error("deleteQuickNote failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]", "page");
  return { ok: true };
}

export async function listMyQuickNotes(
  workspaceId: string,
): Promise<QuickNote[]> {
  return getMyQuickNotes(workspaceId);
}
