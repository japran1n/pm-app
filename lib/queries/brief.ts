// F048: Brief read queries (AS-153).
//
// Mission 20260910-182104, milestone M6 (Brief: schema and team side).
//
// Follows lib/queries/page-links.ts's pair convention: an unfiltered
// team-side reader and a client-facing sibling that relies on RLS
// (20261122040000_f046_brief_rls.sql) to do the actual filtering, rather
// than re-implementing the visibility rule here. Both readers use the
// ordinary RLS-respecting server client (`@/lib/supabase/server`), never
// an admin client -- the whole point of F046's policies is that a client
// session already sees exactly the brief for a portal-enabled project it
// is a member of, and nothing else. AS-153 ("all client contacts on a
// project see the same brief answers") is enforced by
// `brief_answers_select`'s project-scoped predicate (no
// `answered_by = auth.uid()` conjunct), not by anything in this file --
// this file just reads whatever RLS lets the session see.
//
// Column shapes below are read live from
// 20261122010000_f044_brief_tables.sql / 20261122020000_f045_brief_answer_revisions.sql
// (confirmed via information_schema.columns per those migrations'
// headers): brief_questions.options and brief_answers.answer_options are
// `text[]`, not jsonb; brief_answers stores `answer_text`/`answer_options`
// (no single `answer_value` column); brief_answer_revisions stores
// `previous_text`/`previous_options`/`changed_by`/`changed_at` (no
// `old_value` column). This file matches the real schema, not any
// differently-shaped column names a spec draft may have guessed.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type BriefState = "draft" | "submitted" | "approved";

export type Brief = {
  id: string;
  projectId: string;
  state: BriefState;
  createdAt: string;
  updatedAt: string;
};

export type BriefQuestionAnswerType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice";

export type BriefQuestion = {
  id: string;
  projectId: string;
  prompt: string;
  category: string | null;
  answerType: BriefQuestionAnswerType;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
  position: number;
};

export type BriefAnswer = {
  id: string;
  briefId: string;
  questionId: string | null;
  questionPromptSnapshot: string;
  answerText: string | null;
  answerOptions: string[] | null;
  answeredBy: string | null;
  answeredByName?: string | null;
  answeredAt: string | null;
  updatedAt: string;
  // F066 (AS-130/AS-131): true once at least one row exists in
  // brief_answer_revisions for this answer -- i.e. the answer has been
  // edited at least once since it was first saved. Resolved by a
  // follow-up query against brief_answer_revisions rather than a
  // PostgREST-embedded count, since brief_answer_revisions has no FK
  // PostgREST can auto-embed a count through (see getBriefWithRevisions's
  // comment on the same constraint for `changed_by`).
  hasRevisions: boolean;
};

export type BriefAnswerRevision = {
  id: string;
  answerId: string;
  previousText: string | null;
  previousOptions: string[] | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

export type BriefWithQuestionsAndAnswers = {
  brief: Brief | null;
  questions: BriefQuestion[];
  answers: BriefAnswer[];
};

const BRIEF_COLUMNS = "id, project_id, state, created_at, updated_at";
const BRIEF_QUESTION_COLUMNS =
  "id, project_id, prompt, category, answer_type, help_text, required, options, position";
const BRIEF_ANSWER_COLUMNS =
  "id, brief_id, question_id, question_prompt_snapshot, answer_text, answer_options, answered_by, answered_at, updated_at";
const BRIEF_ANSWER_REVISION_COLUMNS =
  "id, answer_id, previous_text, previous_options, changed_by, changed_at";

function mapBriefRow(row: {
  id: string;
  project_id: string;
  state: string;
  created_at: string;
  updated_at: string;
}): Brief {
  return {
    id: row.id,
    projectId: row.project_id,
    state: row.state as BriefState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBriefQuestionRow(row: {
  id: string;
  project_id: string;
  prompt: string;
  category: string | null;
  answer_type: string;
  help_text: string | null;
  required: boolean;
  options: string[] | null;
  position: number;
}): BriefQuestion {
  return {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    category: row.category,
    answerType: row.answer_type as BriefQuestionAnswerType,
    helpText: row.help_text,
    required: row.required,
    options: row.options,
    position: row.position,
  };
}

function mapBriefAnswerRow(
  row: {
    id: string;
    brief_id: string;
    question_id: string | null;
    question_prompt_snapshot: string;
    answer_text: string | null;
    answer_options: string[] | null;
    answered_by: string | null;
    answered_at: string | null;
    updated_at: string;
  },
  hasRevisions = false,
  answeredByName: string | null = null,
): BriefAnswer {
  return {
    id: row.id,
    briefId: row.brief_id,
    questionId: row.question_id,
    questionPromptSnapshot: row.question_prompt_snapshot,
    answerText: row.answer_text,
    answerOptions: row.answer_options,
    answeredBy: row.answered_by,
    answeredByName,
    answeredAt: row.answered_at,
    updatedAt: row.updated_at,
    hasRevisions,
  };
}

function mapBriefAnswerRevisionRow(
  row: {
    id: string;
    answer_id: string;
    previous_text: string | null;
    previous_options: string[] | null;
    changed_by: string | null;
    changed_at: string;
  },
  changedByName: string | null,
): BriefAnswerRevision {
  return {
    id: row.id,
    answerId: row.answer_id,
    previousText: row.previous_text,
    previousOptions: row.previous_options,
    changedBy: row.changed_by,
    changedByName,
    changedAt: row.changed_at,
  };
}

// Resolves display names for the given profile ids. No FK is declared for
// PostgREST to embed, so this is a second select keyed by distinct ids
// (same approach as getBriefWithRevisions's reviser lookup). Failures degrade
// to "no names" rather than failing the whole brief read.
async function loadProfileNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string | null>> {
  const distinct = Array.from(new Set(ids.filter((id): id is string => id !== null)));
  if (distinct.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", distinct);
  if (error) {
    // Real errors (e.g. an RLS denial) must stay visible in logs; names
    // degrade to null ("Someone" in the UI) rather than failing the read.
    logger.error("loadProfileNames: failed to load profiles; names degrade to null", {
      error,
      profileIdCount: distinct.length,
    });
    return new Map();
  }
  return new Map((data ?? []).map((p) => [p.id as string, p.display_name as string | null]));
}

async function loadBriefWithQuestionsAndAnswers(
  projectId: string,
): Promise<PortalQueryResult<BriefWithQuestionsAndAnswers>> {
  const supabase = await createClient();

  const [briefResult, questionsResult] = await Promise.all([
    supabase.from("briefs").select(BRIEF_COLUMNS).eq("project_id", projectId).maybeSingle(),
    supabase
      .from("brief_questions")
      .select(BRIEF_QUESTION_COLUMNS)
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
  ]);

  if (briefResult.error) {
    logger.error("loadBriefWithQuestionsAndAnswers: failed to load brief", {
      error: briefResult.error,
    });
    return { ok: false, error: briefResult.error.message };
  }

  if (questionsResult.error) {
    logger.error("loadBriefWithQuestionsAndAnswers: failed to load questions", {
      error: questionsResult.error,
    });
    return { ok: false, error: questionsResult.error.message };
  }

  const brief = briefResult.data ? mapBriefRow(briefResult.data) : null;
  const questions = (questionsResult.data ?? []).map(mapBriefQuestionRow);

  if (!brief) {
    return { ok: true, data: { brief: null, questions, answers: [] } };
  }

  const { data: answerRows, error: answersError } = await supabase
    .from("brief_answers")
    .select(BRIEF_ANSWER_COLUMNS)
    .eq("brief_id", brief.id);

  if (answersError) {
    logger.error("loadBriefWithQuestionsAndAnswers: failed to load answers", {
      error: answersError,
    });
    return { ok: false, error: answersError.message };
  }

  const answers = answerRows ?? [];

  // AS-130/AS-131: resolve which of these answers has ever been edited, in
  // one follow-up query against brief_answer_revisions keyed by this
  // brief's own answer ids, rather than a per-answer round trip.
  let editedAnswerIds = new Set<string>();
  if (answers.length > 0) {
    const { data: revisionRows, error: revisionsError } = await supabase
      .from("brief_answer_revisions")
      .select("answer_id")
      .in(
        "answer_id",
        answers.map((row) => row.id),
      );

    if (revisionsError) {
      logger.error("loadBriefWithQuestionsAndAnswers: failed to load revision flags", {
        error: revisionsError,
      });
      return { ok: false, error: revisionsError.message };
    }

    editedAnswerIds = new Set((revisionRows ?? []).map((row) => row.answer_id as string));
  }

  const answerNames = await loadProfileNames(
    supabase,
    answers.map((row) => row.answered_by),
  );

  return {
    ok: true,
    data: {
      brief,
      questions,
      answers: answers.map((row) =>
        mapBriefAnswerRow(
          row,
          editedAnswerIds.has(row.id),
          row.answered_by ? (answerNames.get(row.answered_by) ?? null) : null,
        ),
      ),
    },
  };
}

// Team reader -- unfiltered by RLS beyond `is_project_workspace_writer`
// (briefs_select_team / brief_questions_select_team /
// brief_answers_select's team leg), the team's own brief editor screen.
export async function getBrief(
  projectId: string,
): Promise<PortalQueryResult<BriefWithQuestionsAndAnswers>> {
  return loadBriefWithQuestionsAndAnswers(projectId);
}

// Client reader -- same shape and same query, but RLS (briefs_select_client
// / brief_questions_select_client / brief_answers_select's client leg,
// all three requiring membership + client role + portal_enabled) is what
// actually does the filtering, per the same "database does the hiding"
// reasoning lib/queries/portal.ts documents for every other portal read.
// AS-153: every client contact on the project reaches this same query
// with the same result, since the RLS predicate is project-scoped, not
// `answered_by`-scoped.
export async function getBriefForClient(
  projectId: string,
): Promise<PortalQueryResult<BriefWithQuestionsAndAnswers>> {
  return loadBriefWithQuestionsAndAnswers(projectId);
}

// Team only -- one answer plus its full revision history, newest first,
// for the "izmijenjeno · <ime> · <kad>" history view (draft section 4.2).
export async function getBriefWithRevisions(
  briefId: string,
  questionId: string,
): Promise<PortalQueryResult<(BriefAnswer & { revisions: BriefAnswerRevision[] }) | null>> {
  const supabase = await createClient();

  const { data: answerRow, error: answerError } = await supabase
    .from("brief_answers")
    .select(BRIEF_ANSWER_COLUMNS)
    .eq("brief_id", briefId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (answerError) {
    logger.error("getBriefWithRevisions: failed to load answer", { error: answerError });
    return { ok: false, error: answerError.message };
  }

  if (!answerRow) {
    return { ok: true, data: null };
  }

  const { data: revisionRows, error: revisionsError } = await supabase
    .from("brief_answer_revisions")
    .select(BRIEF_ANSWER_REVISION_COLUMNS)
    .eq("answer_id", answerRow.id)
    .order("changed_at", { ascending: false });

  if (revisionsError) {
    logger.error("getBriefWithRevisions: failed to load revisions", {
      error: revisionsError,
    });
    return { ok: false, error: revisionsError.message };
  }

  const rows = revisionRows ?? [];
  // AS-128/AS-155: name the user (team member or client contact) behind the
  // answer and each revision. `changed_by`/`answered_by` are bare auth.users
  // FKs with no FK to `profiles` for PostgREST to embed, so names come from a
  // SINGLE profiles query keyed by the distinct ids, joined in memory.
  const profileIds = Array.from(
    new Set(
      [answerRow.answered_by, ...rows.map((row) => row.changed_by)].filter(
        (id): id is string => id !== null && id !== undefined,
      ),
    ),
  );

  // Profile-name lookup is non-fatal: on failure names stay null.
  const namesById = await loadProfileNames(supabase, profileIds);

  const answer = mapBriefAnswerRow(
    answerRow,
    rows.length > 0,
    answerRow.answered_by ? (namesById.get(answerRow.answered_by) ?? null) : null,
  );

  return {
    ok: true,
    data: {
      ...answer,
      revisions: rows.map((row) =>
        mapBriefAnswerRevisionRow(row, row.changed_by ? (namesById.get(row.changed_by) ?? null) : null),
      ),
    },
  };
}
