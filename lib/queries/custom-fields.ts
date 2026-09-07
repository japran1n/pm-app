// Read-side for project custom fields and their per-task values
// (`project_custom_fields` / `task_custom_field_values`,
// 20261115010000_project_custom_fields.sql). Mirrors
// lib/queries/page-links.ts's file shape.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { CustomFieldType } from "@/lib/validation/custom-fields";

export type ProjectCustomField = {
  id: string;
  projectId: string;
  name: string;
  fieldType: CustomFieldType;
  position: number;
};

export type TaskCustomFieldWithValue = ProjectCustomField & {
  value: string | null;
};

type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string };

const FIELD_COLUMNS = "id, project_id, name, field_type, position";

function mapFieldRow(row: {
  id: string;
  project_id: string;
  name: string;
  field_type: string;
  position: number;
}): ProjectCustomField {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    fieldType: row.field_type as CustomFieldType,
    position: row.position,
  };
}

// The project settings page's own read — every field defined for a
// project, in display order.
export async function getProjectCustomFields(
  projectId: string,
): Promise<QueryResult<ProjectCustomField[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_custom_fields")
    .select(FIELD_COLUMNS)
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getProjectCustomFields: failed to load fields", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapFieldRow) };
}

// The task detail sheet's own read: every custom field defined for the
// task's OWN project, left-joined with this task's current value (null
// for a field that has never been set on this task) — one query, no
// per-field follow-up call, same "single batched read" convention
// lib/queries/page-links.ts documents.
export async function getCustomFieldsForTask(
  taskId: string,
): Promise<QueryResult<TaskCustomFieldWithValue[]>> {
  const supabase = await createClient();

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    logger.error("getCustomFieldsForTask: failed to load task", { error: taskError });
    return { ok: false, error: taskError?.message ?? "Task not found." };
  }

  const [{ data: fields, error: fieldsError }, { data: values, error: valuesError }] =
    await Promise.all([
      supabase
        .from("project_custom_fields")
        .select(FIELD_COLUMNS)
        .eq("project_id", task.project_id)
        .order("position", { ascending: true }),
      supabase
        .from("task_custom_field_values")
        .select("field_id, value")
        .eq("task_id", taskId),
    ]);

  if (fieldsError || valuesError) {
    logger.error("getCustomFieldsForTask: failed to load fields/values", {
      error: fieldsError ?? valuesError,
    });
    return { ok: false, error: (fieldsError ?? valuesError)!.message };
  }

  const valueByFieldId = new Map(
    (values ?? []).map((row) => [row.field_id as string, row.value as string | null]),
  );

  return {
    ok: true,
    data: (fields ?? []).map((row) => ({
      ...mapFieldRow(row),
      value: valueByFieldId.get(row.id) ?? null,
    })),
  };
}
