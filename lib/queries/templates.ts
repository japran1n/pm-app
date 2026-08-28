import { logger } from "@/lib/observability/logger";

// F183: read-side queries for `kind='task'` templates (F181's
// `task_templates` table). Server-only — used by the templates list page
// (full detail: creator, created date, payload preview) and by the board/
// list project pages (a minimal id/name subset, threaded down as a typed
// prop to the "New from template" picker, matching this feature's
// clarified "server-fetched in the page and passed down as typed props;
// client components never query Supabase directly" pattern).
//
// Uses the RLS-respecting client, not the admin client: F181's
// `task_templates_select_active_non_guest` policy already scopes rows to
// active non-guest members of the template's own workspace, which is
// exactly the visibility this feature needs — no reason to bypass RLS for
// a read.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import type { TaskTemplatePayload } from "@/lib/validation/templates";

export type TaskTemplateListItem = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  creatorName: string | null;
  creatorEmail: string | null;
  creatorAvatarUrl: string | null;
  /** A short preview of the saved payload: title + a truncated
   * description snippet, per this feature's clarified "preview of the
   * payload" answer — enough to recognise the template without exposing
   * its full checklist/assignee contents in a list row. */
  previewTitle: string;
  previewDescription: string | null;
};

export type TaskTemplatePickerOption = {
  id: string;
  name: string;
};

const DESCRIPTION_PREVIEW_LENGTH = 140;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}…`;
}

// Full detail listing for the /templates page: name, creator, created
// date, and a payload preview, newest first. One batched `resolvePeople`
// call for every creator id in the result set — no per-row query, per
// this feature's inherited "no N+1 queries per row" performance budget.
export async function getWorkspaceTaskTemplates(
  workspaceId: string,
): Promise<TaskTemplateListItem[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("task_templates")
    .select("id, name, payload, created_by, created_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", "task")
    .order("created_at", { ascending: false });

  if (error || !rows) {
    logger.error("getWorkspaceTaskTemplates: query failed", { error: error });
    return [];
  }

  const creatorIds = Array.from(new Set(rows.map((row) => row.created_by as string)));
  const creators = await resolvePeople(creatorIds);

  return rows.map((row) => {
    const payload = row.payload as unknown as Partial<TaskTemplatePayload> | null;
    const creator = creators.get(row.created_by as string);
    const description = payload?.description ?? null;

    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
      creatorName: creator?.name ?? null,
      creatorEmail: creator?.email ?? null,
      creatorAvatarUrl: creator?.avatarUrl ?? null,
      previewTitle: payload?.title ?? row.name,
      previewDescription: description
        ? truncate(description, DESCRIPTION_PREVIEW_LENGTH)
        : null,
    };
  });
}

// Minimal id/name listing for the "New from template" picker embedded in
// the new-task dialog and board/list toolbars — deliberately narrow (no
// payload/creator fields) since the picker only needs enough to let a
// caller choose a template by name before calling createTaskFromTemplate.
export async function getWorkspaceTaskTemplateOptions(
  workspaceId: string,
): Promise<TaskTemplatePickerOption[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("task_templates")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("kind", "task")
    .order("name", { ascending: true });

  if (error || !rows) {
    logger.error("getWorkspaceTaskTemplateOptions: query failed", { error: error });
    return [];
  }

  return rows.map((row) => ({ id: row.id as string, name: row.name as string }));
}

// F184: minimal id/name listing for the "Start from template" option in
// the new-project dialog — same shape/rationale as
// getWorkspaceTaskTemplateOptions above, filtered to `kind = 'project'`.
export async function getWorkspaceProjectTemplateOptions(
  workspaceId: string,
): Promise<TaskTemplatePickerOption[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("task_templates")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("kind", "project")
    .order("name", { ascending: true });

  if (error || !rows) {
    logger.error("getWorkspaceProjectTemplateOptions: query failed", { error: error });
    return [];
  }

  return rows.map((row) => ({ id: row.id as string, name: row.name as string }));
}
