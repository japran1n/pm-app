"use server";

// Server Actions for the brief questionnaire editor (F049, AS-101,
// AS-112). Mirrors lib/actions/docs.ts / lib/actions/tasks/create.ts's
// conventions: plain RLS-respecting `createClient()` (never an admin
// client), Zod validation before any DB write, a discriminated-union
// return type, and generic user-facing errors with details only logged
// server-side (AS-146).
//
// Auth model: this module does NOT re-implement membership checks itself.
// `brief_questions_insert_team` / `_update_team` / `_delete_team`
// (supabase/migrations/20261122040000_f046_brief_rls.sql) already gate
// every write to `is_project_workspace_writer(project_id)` -- exactly the
// "workspace writer only, viewer and client excluded" rule AS-089/AS-161
// describe -- so RLS is the real enforcement boundary. A non-writer's
// insert/update/delete simply returns 0 affected rows (RLS silently
// filters, matching Postgres RLS's normal behaviour for a `with check`
// failure on insert or a `using` failure on update/delete), which this
// module surfaces as a generic "not found or not allowed" error rather
// than attempting to distinguish "row missing" from "row present but not
// writable" -- the same ambiguity every other RLS-gated action in this
// codebase accepts (e.g. lib/actions/docs.ts's writes).
//
// briefs.project_id is unique (20261122010000_f044_brief_tables.sql), so
// `ensureBrief` is a plain "insert if not exists, else read" -- no
// upsert-with-conflict-target trick needed beyond that unique constraint
// itself backing an `on conflict do nothing` style flow.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { calculatePosition } from "@/lib/board/position";
import {
  createQuestionSchema,
  updateQuestionSchema,
  type CreateQuestionInput,
  type UpdateQuestionInput,
} from "@/lib/validation/brief";

export type BriefQuestionResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        prompt: string;
        category: string | null;
        answerType: string;
        helpText: string | null;
        required: boolean;
        options: string[] | null;
        position: number;
      };
    }
  | { ok: false; error: string };

export type DeleteBriefQuestionResult = { ok: true } | { ok: false; error: string };

const QUESTION_COLUMNS =
  "id, project_id, prompt, category, answer_type, help_text, required, options, position";

function mapQuestionRow(row: {
  id: string;
  project_id: string;
  prompt: string;
  category: string | null;
  answer_type: string;
  help_text: string | null;
  required: boolean;
  options: string[] | null;
  position: number;
}) {
  return {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    category: row.category,
    answerType: row.answer_type,
    helpText: row.help_text,
    required: row.required,
    options: row.options,
    position: row.position,
  };
}

// Creates the project's `briefs` row if one does not exist yet
// (briefs.project_id is unique -- AS-099). Not exported: this is a helper
// for createBriefQuestion below, which is the only caller that needs a
// brief to exist purely so the questionnaire has somewhere to hang once
// answers start arriving (F076+) -- brief_questions itself is keyed by
// project_id directly (20261122010000), not brief_id, so this call does
// not gate question creation on anything beyond "a briefs row exists".
async function ensureBrief(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("briefs")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (selectError) {
    logger.error("ensureBrief: failed to check for existing brief", {
      error: selectError,
      projectId,
    });
    return { ok: false, error: "Couldn't load this project's brief." };
  }

  if (existing) {
    return { ok: true };
  }

  const { error: insertError } = await supabase.from("briefs").insert({ project_id: projectId });

  if (insertError) {
    logger.error("ensureBrief: failed to create brief", { error: insertError, projectId });
    return { ok: false, error: "Couldn't create this project's brief." };
  }

  return { ok: true };
}

// Adds a question to a project's questionnaire, appended to the end of
// the existing ordering (AS-101). AS-112 (empty prompt rejected) is
// enforced by createQuestionSchema before any DB call is attempted, and
// again at the database boundary by `brief_questions_prompt_not_empty`
// (20261122010000) as the real enforcement layer -- same "validate
// client-side, DB CHECK is the ground truth" pattern documented in
// lib/validation/tasks.ts.
export async function createBriefQuestion(
  projectId: string,
  data: CreateQuestionInput,
): Promise<BriefQuestionResult> {
  const parsed = createQuestionSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to add a question." };
  }

  const ensured = await ensureBrief(supabase, projectId);
  if (!ensured.ok) {
    return { ok: false, error: ensured.error };
  }

  // Append to the end of this project's question order (same
  // last-sibling-lookup + calculatePosition pattern as
  // lib/tasks/create.ts's AS-079 position assignment -- an empty
  // questionnaire falls back to calculatePosition's own default via
  // `lastInColumn?.position ?? null`).
  const { data: lastQuestion, error: lastQuestionError } = await supabase
    .from("brief_questions")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastQuestionError) {
    logger.error("createBriefQuestion: failed to load last question position", {
      error: lastQuestionError,
      projectId,
    });
    return { ok: false, error: "Couldn't add this question." };
  }

  const newPosition = calculatePosition(lastQuestion?.position ?? null, null);

  const { data: inserted, error: insertError } = await supabase
    .from("brief_questions")
    .insert({
      project_id: projectId,
      prompt: parsed.data.prompt,
      category: parsed.data.category,
      answer_type: parsed.data.answerType,
      help_text: parsed.data.helpText ?? null,
      required: parsed.data.required,
      options: parsed.data.options ?? null,
      position: newPosition,
    })
    .select(QUESTION_COLUMNS)
    .single();

  if (insertError || !inserted) {
    logger.error("createBriefQuestion: insert failed", { error: insertError, projectId });
    return {
      ok: false,
      error: "Couldn't add this question. You may not have permission to edit this brief.",
    };
  }

  return { ok: true, data: mapQuestionRow(inserted) };
}

// Partial update of an existing question (prompt, category, answer type,
// help text, required flag, options). RLS's `brief_questions_update_team`
// policy is the write-permission boundary; AS-112 is re-enforced here for
// any prompt included in the partial update via updateQuestionSchema.
export async function updateBriefQuestion(
  questionId: string,
  data: UpdateQuestionInput,
): Promise<BriefQuestionResult> {
  const parsed = updateQuestionSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to edit this question." };
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.prompt !== undefined) patch.prompt = parsed.data.prompt;
  if (parsed.data.category !== undefined) patch.category = parsed.data.category;
  if (parsed.data.answerType !== undefined) patch.answer_type = parsed.data.answerType;
  if (parsed.data.helpText !== undefined) patch.help_text = parsed.data.helpText;
  if (parsed.data.required !== undefined) patch.required = parsed.data.required;
  if (parsed.data.options !== undefined) patch.options = parsed.data.options;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("brief_questions")
    .update(patch)
    .eq("id", questionId)
    .select(QUESTION_COLUMNS)
    .maybeSingle();

  if (updateError) {
    logger.error("updateBriefQuestion: update failed", { error: updateError, questionId });
    return { ok: false, error: "Couldn't save this question." };
  }

  if (!updated) {
    return {
      ok: false,
      error: "Couldn't save this question. It may not exist or you may not have permission.",
    };
  }

  return { ok: true, data: mapQuestionRow(updated) };
}

// Deletes a question. Answers already given to it are preserved --
// `brief_answers.question_id` has `on delete set null`
// (20261122010000_f044_brief_tables.sql) and `question_prompt_snapshot`
// already holds the question's text independently of the `brief_questions`
// row, so a deleted question's past answer remains fully readable
// (draft section 4.1). No application-side snapshot logic is needed
// here -- the FK behaviour and the snapshot column already do this.
export async function deleteBriefQuestion(questionId: string): Promise<DeleteBriefQuestionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to delete this question." };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("brief_questions")
    .delete()
    .eq("id", questionId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    logger.error("deleteBriefQuestion: delete failed", { error: deleteError, questionId });
    return { ok: false, error: "Couldn't delete this question." };
  }

  if (!deleted) {
    return {
      ok: false,
      error: "Couldn't delete this question. It may not exist or you may not have permission.",
    };
  }

  return { ok: true };
}
