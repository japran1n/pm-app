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
import { getCurrentUser } from "@/lib/auth/current-user";
import { calculatePosition } from "@/lib/board/position";
import { getBrief, type BriefAnswer, type BriefQuestion } from "@/lib/queries/brief";
import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { buildBriefDocumentContent } from "@/lib/brief/document";
import { createNotification } from "@/lib/notifications/create-notification";
import {
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
  saveBriefAnswerSchema,
  type CreateQuestionInput,
  type UpdateQuestionInput,
} from "@/lib/validation/brief";
import {
  revalidatePortalProject,
  extractWorkspaceSlug,
} from "@/lib/actions/portal-revalidate";
import type { ActionOutcome, ActionResult } from "@/lib/actions/authz";

// F004c (AS-006): the brief questionnaire is entirely portal-visible (the
// portal's Questionnaire page renders questions/answers straight from
// these tables), so EVERY mutation in this file revalidates the portal,
// unlike most other actions in this codebase that gate on a per-row
// `client_visible` flag. None of this file's existing selects carry a
// workspace slug (this module deliberately never touches `workspaces` —
// see the file's own header comment on RLS being the enforcement
// boundary), so this is one small extra lookup per mutation rather than a
// widened existing select — acceptable here since these are editor-save
// paths, not a drag/board hot path.
async function revalidatePortalForBriefProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<void> {
  // Non-fatal, whole-function try/catch (not just around the query): this
  // must never turn a real save/submit/approve into a failure just because
  // the portal-refresh side effect couldn't resolve a slug, matching every
  // other `revalidate*` helper's own non-fatal convention in this
  // codebase.
  try {
    const { data: projectRow, error } = await supabase
      .from("projects")
      .select("workspaces(slug)")
      .eq("id", projectId)
      .maybeSingle();

    if (error) {
      logger.error("revalidatePortalForBriefProject: failed to load workspace slug", {
        error,
        projectId,
      });
      return;
    }

    const slug = extractWorkspaceSlug(
      projectRow?.workspaces as { slug: string } | { slug: string }[] | null,
    );
    if (slug) {
      revalidatePortalProject(slug, projectId);
    }
  } catch (unexpectedError) {
    logger.error("revalidatePortalForBriefProject: unexpected failure (non-fatal)", {
      error: unexpectedError,
      projectId,
    });
  }
}

export type BriefQuestionResult = ActionResult<{
        id: string;
        projectId: string;
        prompt: string;
        category: string | null;
        answerType: string;
        helpText: string | null;
        required: boolean;
        options: string[] | null;
        position: number;
      }>;

export type DeleteBriefQuestionResult = ActionOutcome;

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

  const { supabase, user } = await getCurrentUser();
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

  await revalidatePortalForBriefProject(supabase, projectId);

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

  const { supabase, user } = await getCurrentUser();
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

  await revalidatePortalForBriefProject(supabase, updated.project_id);

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
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to delete this question." };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("brief_questions")
    .delete()
    .eq("id", questionId)
    .select("id, project_id")
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

  await revalidatePortalForBriefProject(supabase, deleted.project_id);

  return { ok: true };
}

// Persists (creates or updates) one answer to one question, without any
// explicit "save" control on the client -- F057, AS-116/AS-118. There is
// no unique constraint on (brief_id, question_id) in brief_answers
// (verified live via Supabase MCP + 20261122010000_f044_brief_tables.sql),
// so this cannot use Postgres `on conflict`; instead it selects the
// existing row for this brief+question first, then updates it if found or
// inserts a fresh one otherwise -- same "select, then branch" shape
// ensureBrief above already uses for briefs.project_id.
//
// question_prompt_snapshot is (re)stamped from the live
// brief_questions.prompt on every save, per the spec -- this keeps the
// snapshot fresh while the question still exists, and it's this same
// snapshot that AS-118 partly rests on: even after a reload, the answer
// row (and the prompt text it captured) is still there to read back.
// answered_by/answered_at record who last saved and when; the
// brief_answer_revisions row per change is written by a database trigger
// (F045, standing-decisions.md #14), never from this action.
// F068: fans out a `brief_answer_changed` in-app notification to a
// project's decision owners (project_decision_owners,
// 20260916010000_approval_requests.sql) whenever an already-answered
// question is changed while the brief is no longer 'draft' (AS-136).
// Called only from saveBriefAnswer's `existing`/update branch -- the
// first time a question is answered is not a "change" in the spec's
// sense, and AS-137 requires this to never fire while brief.state =
// 'draft', which the `state === 'submitted' || state === 'approved'`
// gate below enforces regardless of how many decision owners exist (zero
// owners is a no-op, not an error). Non-fatal, same convention as every
// other createNotification call site: a failure here must never fail the
// caller's answer save.
async function notifyDecisionOwnersOfAnswerChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  briefId: string,
  questionId: string,
  actorUserId: string,
): Promise<void> {
  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .select("state, project_id")
    .eq("id", briefId)
    .maybeSingle();

  if (briefError || !brief) {
    logger.error("notifyDecisionOwnersOfAnswerChange: failed to load brief", {
      error: briefError,
      briefId,
    });
    return;
  }

  if (brief.state !== "submitted" && brief.state !== "approved") {
    // AS-137: still 'draft' (or any other pre-submission state) -- no
    // notification.
    return;
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", brief.project_id)
    .maybeSingle();

  if (projectError || !project) {
    logger.error("notifyDecisionOwnersOfAnswerChange: failed to load project", {
      error: projectError,
      projectId: brief.project_id,
    });
    return;
  }

  const { data: owners, error: ownersError } = await supabase
    .from("project_decision_owners")
    .select("user_id")
    .eq("project_id", brief.project_id);

  if (ownersError) {
    logger.error("notifyDecisionOwnersOfAnswerChange: failed to load decision owners", {
      error: ownersError,
      projectId: brief.project_id,
    });
    return;
  }

  for (const owner of owners ?? []) {
    await createNotification(
      supabase,
      {
        userId: owner.user_id,
        workspaceId: project.workspace_id,
        kind: "brief_answer_changed",
        payload: { project_id: brief.project_id, brief_id: briefId, question_id: questionId, changed_by: actorUserId },
      },
      "notifyDecisionOwnersOfAnswerChange",
    );
  }
}

// SEC-ACT4-07 / GAP3-04 (audit 2026-09-24):
//   - input is validated (uuids, length caps on text/options);
//   - the question must belong to the brief's project, and choice answers
//     must pick from the question's own options;
//   - an unchanged answer is a no-op (autosave re-sends identical values;
//     no write, no revision, no notification);
//   - the write is a single upsert on the unique (brief_id, question_id)
//     index (migration 20261131010000), so concurrent first saves can no
//     longer create duplicate answer rows;
//   - revision coalescing (same author re-saving within a few minutes) is
//     done by the record_brief_answer_revision trigger in that migration.
export async function saveBriefAnswer(
  briefId: string,
  questionId: string,
  answerText: string | null,
  answerOptions: string[] | null,
): Promise<{ success: boolean; error?: string }> {
  const parsed = saveBriefAnswerSchema.safeParse({
    briefId,
    questionId,
    answerText: answerText ?? null,
    answerOptions: answerOptions ?? null,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Couldn't save this answer.",
    };
  }
  const input = parsed.data;

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to save an answer." };
  }

  const { data: question, error: questionError } = await supabase
    .from("brief_questions")
    .select("prompt, project_id, answer_type, options")
    .eq("id", input.questionId)
    .maybeSingle();

  if (questionError) {
    logger.error("saveBriefAnswer: failed to load question prompt", {
      error: questionError,
      questionId: input.questionId,
    });
    return { success: false, error: "Couldn't save this answer." };
  }

  if (!question) {
    return { success: false, error: "Couldn't save this answer. The question was not found." };
  }

  // F076 (AS-149/AS-150): approval freezes answers for every role, no
  // team-only escape hatch (standing decision #16). RLS
  // (brief_answers_insert/_update, 20261122040000_f046_brief_rls.sql)
  // already enforces this as the real boundary -- this check exists so
  // the action surfaces a clear "locked" message instead of a generic
  // RLS-denial error for both the client and team write paths this
  // function serves.
  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .select("state, project_id")
    .eq("id", input.briefId)
    .maybeSingle();

  if (briefError) {
    logger.error("saveBriefAnswer: failed to load brief state", { error: briefError, briefId });
    return { success: false, error: "Couldn't save this answer." };
  }

  if (!brief || brief.project_id !== question.project_id) {
    return { success: false, error: "Couldn't save this answer. The question was not found." };
  }

  if (brief.state === "approved") {
    return { success: false, error: "Brief is approved and answers are locked." };
  }

  const isChoice =
    question.answer_type === "single_choice" || question.answer_type === "multi_choice";
  let options = input.answerOptions;
  if (isChoice && options) {
    const allowed = new Set<string>((question.options as string[] | null) ?? []);
    options = Array.from(new Set(options));
    if (!options.every((option) => allowed.has(option))) {
      return { success: false, error: "Choose one of the listed options." };
    }
    if (question.answer_type === "single_choice" && options.length > 1) {
      return { success: false, error: "Choose one option." };
    }
  } else if (!isChoice && options && options.length > 0) {
    return { success: false, error: "This question takes a written answer." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("brief_answers")
    .select("id, answer_text, answer_options")
    .eq("brief_id", input.briefId)
    .eq("question_id", input.questionId)
    .maybeSingle();

  if (existingError) {
    logger.error("saveBriefAnswer: failed to check for existing answer", {
      error: existingError,
      briefId,
      questionId,
    });
    return { success: false, error: "Couldn't save this answer." };
  }

  if (
    existing &&
    (existing.answer_text ?? null) === input.answerText &&
    sameOptions(existing.answer_options as string[] | null, options)
  ) {
    return { success: true };
  }

  const { error: upsertError } = await supabase.from("brief_answers").upsert(
    {
      brief_id: input.briefId,
      question_id: input.questionId,
      question_prompt_snapshot: question.prompt,
      answer_text: input.answerText,
      answer_options: options,
      answered_by: user.id,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "brief_id,question_id" },
  );

  if (upsertError) {
    logger.error("saveBriefAnswer: upsert failed", { error: upsertError, briefId, questionId });
    return { success: false, error: "Couldn't save this answer." };
  }

  if (existing) {
    // F068 (AS-136/AS-137): only an already-answered question being
    // CHANGED can need a post-submission notice, and only once the brief
    // has left 'draft' (checked inside). Non-fatal.
    await notifyDecisionOwnersOfAnswerChange(supabase, input.briefId, input.questionId, user.id);
  }

  await revalidatePortalForBriefProject(supabase, brief.project_id);

  return { success: true };
}

function sameOptions(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// GAP3-04: answers (client-authored) and prompts are inserted into a
// Markdown document that the docs editor parses with raw HTML enabled.
// Backslash-escape every Markdown/HTML-significant ASCII punctuation mark
// (CommonMark treats `\<char>` as that literal character), so an answer
// renders as the literal text the client typed — never as HTML, links,
// images, headings or list syntax.
const MARKDOWN_SPECIAL = /[\\`*_{}[\]()<>#+\-.!|~&:]/g;

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(MARKDOWN_SPECIAL, (char) => `\\${char}`);
}

function escapeBriefForDocument(
  questions: BriefQuestion[],
  answers: BriefAnswer[],
): { questions: BriefQuestion[]; answers: BriefAnswer[] } {
  return {
    questions: questions.map((question) => ({
      ...question,
      prompt: escapeMarkdownText(question.prompt),
    })),
    answers: answers.map((answer) => ({
      ...answer,
      answerText: answer.answerText === null ? null : escapeMarkdownText(answer.answerText),
      answerOptions: answer.answerOptions?.map(escapeMarkdownText) ?? null,
    })),
  };
}

// Marks a brief as submitted (F061, AS-124/AS-125). Submission is
// idempotent -- resubmitting a brief already in 'submitted' is a no-op
// success rather than an error, matching AS-126's "answers stay editable
// after submit" framing: a client may revisit and resubmit freely. This
// intentionally never writes 'approved' -- approval is a separate,
// team-side action (out of scope here) that this action must not
// perform even if called repeatedly. RLS (`briefs_update_client`,
// F046) is the real boundary preventing a client from writing any state
// other than what that policy allows once a brief is 'approved'; this
// action's `.eq("state", ...)` filter below is a defense-in-depth guard
// that also makes "already submitted" naturally idempotent without a
// second round-trip to check state first.
export async function submitBrief(briefId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to submit this brief." };
  }

  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .select("id, state, project_id")
    .eq("id", briefId)
    .maybeSingle();

  if (briefError) {
    logger.error("submitBrief: failed to load brief", { error: briefError, briefId });
    return { success: false, error: "Couldn't submit this brief." };
  }

  if (!brief) {
    return { success: false, error: "Couldn't submit this brief. It may not exist." };
  }

  if (brief.state === "submitted") {
    return { success: true };
  }

  if (brief.state !== "draft") {
    return { success: false, error: "This brief can no longer be submitted." };
  }

  // BR-015/BR-016/BR-044/BR-047: the client-side gate is not enough; enforce
  // server-side that every required question has an answer per the shared rule.
  const { data: requiredQuestions, error: requiredError } = await supabase
    .from("brief_questions")
    .select("id, answer_type")
    .eq("project_id", brief.project_id)
    .eq("required", true);
  const { data: answerRows, error: answersError } = await supabase
    .from("brief_answers")
    .select("question_id, answer_text, answer_options")
    .eq("brief_id", briefId);

  if (requiredError || answersError) {
    logger.error("submitBrief: failed to load required check data", {
      error: requiredError ?? answersError,
      briefId,
    });
    return { success: false, error: "Couldn't submit this brief." };
  }

  const answersByQuestion = new Map(
    (answerRows ?? []).map((a) => [a.question_id, a]),
  );
  const missing = (requiredQuestions ?? []).filter((rq) => {
    const a = answersByQuestion.get(rq.id);
    return !isBriefAnswerAnswered(
      { answerType: rq.answer_type as BriefQuestion["answerType"] },
      a ? { answerText: a.answer_text, answerOptions: a.answer_options } : null,
    );
  });
  if (missing.length > 0) {
    return {
      success: false,
      error: "Answer all required questions before submitting this brief.",
    };
  }

  const { error: updateError } = await supabase
    .from("briefs")
    .update({ state: "submitted" })
    .eq("id", briefId)
    .eq("state", "draft");

  if (updateError) {
    logger.error("submitBrief: update failed", { error: updateError, briefId });
    return { success: false, error: "Couldn't submit this brief." };
  }

  await revalidatePortalForBriefProject(supabase, brief.project_id);

  return { success: true };
}

// Persists a new question order after a drag-and-drop reorder (F052,
// AS-107, AS-108). Mirrors lib/actions/projects.ts's `reorderProject`
// "the client already computed the full target order, this action just
// writes it" division of labour, except here the caller (the sortable
// list component) sends every question's new `position` in one call
// rather than this action recomputing positions server-side -- there's
// no cross-project sibling scan needed since brief_questions.position is
// a plain float column (20261122010000_f044_brief_tables.sql), not an
// integer needing re-sequencing.
//
// `brief_questions_update_team` (20261122040000_f046_brief_rls.sql) is
// the real enforcement boundary for "only a workspace writer can
// reorder" -- same RLS-does-the-gating pattern documented at the top of
// this file. A non-writer's updates simply affect 0 rows each; this
// action does not attempt to distinguish that from "row missing" for the
// same reason updateBriefQuestion above doesn't.
export async function reorderBriefQuestions(
  updates: { id: string; position: number }[],
): Promise<{ success: boolean; error?: string }> {
  const parsed = reorderQuestionsSchema.safeParse({ questions: updates });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid question order.",
    };
  }

  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to reorder questions." };
  }

  const results = await Promise.all(
    parsed.data.questions.map(({ id, position }) =>
      supabase.from("brief_questions").update({ position }).eq("id", id),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    logger.error("reorderBriefQuestions: update failed", { error: failed.error });
    return { success: false, error: "Couldn't save the new question order." };
  }

  // F004c (AS-006): resolve the (single, in practice) project these
  // reordered questions belong to from the rows just updated — one extra
  // query covering the whole batch, not one per question.
  const { data: projectRows } = await supabase
    .from("brief_questions")
    .select("project_id")
    .in(
      "id",
      parsed.data.questions.map((q) => q.id),
    );
  const projectIds = new Set(
    (projectRows ?? []).map((row) => row.project_id as string),
  );
  for (const projectId of projectIds) {
    await revalidatePortalForBriefProject(supabase, projectId);
  }

  return { success: true };
}

// Generates the brief document (F071, AS-139/AS-140/AS-141/AS-142). No
// AI involved (standing-decisions.md #11): `buildBriefDocumentContent`
// (lib/brief/document.ts) is a fixed four-section template that quotes
// each question's prompt and the client's current answer beneath it.
// Stored as a normal `docs` row with `doc_kind = 'brief'` (AS-142), the
// vocabulary F047 (20261122030000_f047_docs_brief_kind.sql) widened for
// exactly this purpose -- no new table. `workspace_id` is required by
// `docs` (20260904010000_docs_system.sql) but not carried on `briefs`,
// so it's read off the parent `projects` row, same as `createDoc`
// (lib/actions/docs.ts) resolves it from its caller.
export async function generateBriefDocument(
  projectId: string,
  briefId: string,
): Promise<{ success: boolean; documentId?: string; error?: string }> {
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to generate this document." };
  }

  const briefResult = await getBrief(projectId);
  if (!briefResult.ok) {
    logger.error("generateBriefDocument: failed to load brief", {
      error: briefResult.error,
      projectId,
    });
    return { success: false, error: "Couldn't generate the brief document." };
  }

  const { brief, questions, answers } = briefResult.data;
  if (!brief || brief.id !== briefId) {
    return { success: false, error: "Couldn't generate the brief document. The brief was not found." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    logger.error("generateBriefDocument: failed to load project", {
      error: projectError,
      projectId,
    });
    return { success: false, error: "Couldn't generate the brief document." };
  }

  // GAP3-04: escape client-authored text before it becomes Markdown.
  const escaped = escapeBriefForDocument(questions, answers);
  const content = buildBriefDocumentContent(escaped.questions, escaped.answers);

  const { data: inserted, error: insertError } = await supabase
    .from("docs")
    .insert({
      workspace_id: project.workspace_id,
      project_id: projectId,
      title: "Project Brief",
      content,
      doc_kind: "brief",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("generateBriefDocument: insert failed", { error: insertError, projectId });
    return { success: false, error: "Couldn't generate the brief document." };
  }

  await revalidatePortalForBriefProject(supabase, projectId);

  return { success: true, documentId: inserted.id };
}

// ---------------------------------------------------------------------
// requestBriefApproval / approveBrief (F074/F075, AS-145/AS-146/AS-147)
// ---------------------------------------------------------------------

// Pure payload builder for F074 (AS-146: "an approval request for a
// brief records the document as its subject"). Kept separate from
// requestBriefApproval's DB round trip so the subject-recording shape
// (subject_type/subject_id) is directly unit-testable without a live
// Supabase client, same "extract the pure shape, test it directly"
// approach lib/brief/document.ts's buildBriefDocumentContent already
// takes for F071.
//
// Reuses the existing `approval_requests` table (F007,
// supabase/migrations/20260916010000_approval_requests.sql) rather than
// a new brief-specific table -- that table's `subject_type` CHECK
// already accepts 'doc' (approval_requests_subject_type_check), and the
// brief document generated by generateBriefDocument above is itself
// stored as a `docs` row (doc_kind = 'brief'), so "the brief document is
// the subject" is exactly `subject_type: 'doc', subject_id: docId`.
// `decision_type: 'content'` is the closest fit among the existing
// closed vocabulary (content/brand/technical/commercial) for a written
// brief document.
export async function buildBriefApprovalRequestPayload(
  projectId: string,
  docId: string,
  requestedBy: string,
) {
  return {
    project_id: projectId,
    subject_type: "doc" as const,
    subject_id: docId,
    title: "Project Brief",
    decision_type: "content" as const,
    requested_by: requestedBy,
  };
}

export type RequestBriefApprovalResult = { success: boolean; error?: string };

// Creates an approval request for the brief document (F074, AS-145: "the
// team can request approval of the brief document"). RLS
// (`approval_requests_insert_team`,
// supabase/migrations/20260916010000_approval_requests.sql) is the real
// enforcement boundary for "only a workspace writer may request
// approval" -- same "RLS gates, action surfaces a generic error"
// convention documented at the top of this file -- so this action does
// not re-derive membership/write access itself.
export async function requestBriefApproval(
  projectId: string,
  docId: string,
): Promise<RequestBriefApprovalResult> {
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to request approval." };
  }

  const { data: doc, error: docError } = await supabase
    .from("docs")
    .select("id, project_id, doc_kind")
    .eq("id", docId)
    .maybeSingle();

  if (docError) {
    logger.error("requestBriefApproval: failed to load brief document", {
      error: docError,
      docId,
    });
    return { success: false, error: "Couldn't request approval." };
  }

  if (!doc || doc.project_id !== projectId || doc.doc_kind !== "brief") {
    return { success: false, error: "Couldn't request approval. The brief document was not found." };
  }

  const { error: insertError } = await supabase
    .from("approval_requests")
    .insert(buildBriefApprovalRequestPayload(projectId, docId, user.id));

  if (insertError) {
    logger.error("requestBriefApproval: insert failed", { error: insertError, projectId, docId });
    return {
      success: false,
      error: "Couldn't request approval. You may not have permission to do this.",
    };
  }

  await revalidatePortalForBriefProject(supabase, projectId);

  return { success: true };
}

export type ApproveBriefResult = { success: boolean; error?: string };

// Approves a brief (F075, AS-147: "approving the brief sets the brief
// state to approved"). Team-side only -- RLS's `briefs_update_team`
// policy (20261122040000_f046_brief_rls.sql) is the enforcement
// boundary; a client session's update simply affects 0 rows, same
// "RLS gates, action surfaces a generic not-found/not-allowed error"
// convention every other write in this file follows.
export async function approveBrief(briefId: string): Promise<ApproveBriefResult> {
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to approve this brief." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("briefs")
    .update({ state: "approved" })
    .eq("id", briefId)
    .select("id, project_id")
    .maybeSingle();

  if (updateError) {
    logger.error("approveBrief: update failed", { error: updateError, briefId });
    return { success: false, error: "Couldn't approve this brief." };
  }

  if (!updated) {
    return {
      success: false,
      error: "Couldn't approve this brief. It may not exist or you may not have permission.",
    };
  }

  await revalidatePortalForBriefProject(supabase, updated.project_id);

  return { success: true };
}

export type WithdrawBriefApprovalResult = { success: boolean; error?: string };

// F077 (AS-151): withdrawing approval makes answers editable again.
// Reverts brief.state from 'approved' back to 'submitted' -- 'submitted'
// rather than 'draft' because withdrawal is "undo the approval", not
// "undo the client's submission" (the brief was already submitted before
// it could be approved at all; briefs_update_team's RLS policy, which
// this write relies on the same way approveBrief does, allows a
// workspace writer to set any state, so the `.eq("state", "approved")`
// guard below is this function's own safety net against a no-op
// withdrawal silently "succeeding" on a brief that was never approved).
export async function withdrawBriefApproval(briefId: string): Promise<WithdrawBriefApprovalResult> {
  const { supabase, user } = await getCurrentUser();
  if (!user) {
    return { success: false, error: "You must be signed in to withdraw this approval." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("briefs")
    .update({ state: "submitted" })
    .eq("id", briefId)
    .eq("state", "approved")
    .select("id, project_id")
    .maybeSingle();

  if (updateError) {
    logger.error("withdrawBriefApproval: update failed", { error: updateError, briefId });
    return { success: false, error: "Couldn't withdraw this approval." };
  }

  if (!updated) {
    return {
      success: false,
      error: "Couldn't withdraw this approval. It may not exist or may not be approved.",
    };
  }

  await revalidatePortalForBriefProject(supabase, updated.project_id);

  return { success: true };
}
