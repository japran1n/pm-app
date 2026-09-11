"use client";

import { useMemo, useState } from "react";

import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";
import { saveBriefAnswer, submitBrief } from "@/lib/actions/brief";
import { useAutosave } from "@/lib/hooks/use-autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionnaireProgress } from "@/components/brief/questionnaire-progress";
import { AnswerInput } from "@/components/brief/answer-input";

// F055 (missions/20260910-182104, AS-113, AS-114): the client-facing
// questionnaire. AS-114 ("one question at a time") is the whole reason
// this is a Client Component rather than a static server-rendered list --
// `currentIndex` is local UI state, not anything that needs to survive a
// reload or round-trip through the server.
//
// F059 (AS-119, AS-120, AS-121, AS-122) replaces the original textarea
// stub with <AnswerInput>, which renders the right widget per
// `answerType` (short_text/long_text/single_choice/multi_choice) and
// reports edits back up here as a (text, options) pair. This component
// stays the single owner of the autosave draft so F057's debounced-save
// wiring doesn't need to change per answer type.
// F057 (AS-116, AS-118): briefId is optional so F055's original render
// tests (no briefId passed) keep passing -- autosave simply has nothing
// to persist to without a brief to attach the answer to, which never
// happens on the real portal route now that the page below always passes
// the loaded brief's id.
//
// F060 (AS-123): a required question must be answered before the brief
// can advance past it. `isAnswered` mirrors the "counts as answered"
// rule already used by F058's resume-position logic, applied per-type:
// short_text/long_text need non-empty answer_text, single_choice needs
// exactly one selected option, multi_choice needs at least one.
export function isAnswered(
  question: BriefQuestion,
  draft: { text: string | null; options: string[] | null },
): boolean {
  switch (question.answerType) {
    case "single_choice":
      return (draft.options?.length ?? 0) === 1;
    case "multi_choice":
      return (draft.options?.length ?? 0) >= 1;
    case "short_text":
    case "long_text":
    default:
      return Boolean(draft.text && draft.text.trim() !== "");
  }
}

export function PortalQuestionnaire({
  questions,
  initialAnswers,
  briefId,
}: {
  questions: BriefQuestion[];
  initialAnswers: BriefAnswer[];
  briefId?: string | null;
}) {
  // F058 (AS-117): resume at the first unanswered question on load rather
  // than always starting at index 0. An answer "counts" if it has non-empty
  // text or at least one selected option. If every question is answered,
  // land on the last one; if none are answered, index 0 is already correct.
  const firstUnanswered = questions.findIndex(
    (q) =>
      !initialAnswers.some(
        (a) =>
          a.questionId === q.id &&
          (Boolean(a.answerText) || (a.answerOptions && a.answerOptions.length > 0)),
      ),
  );
  const [currentIndex, setCurrentIndex] = useState(
    firstUnanswered === -1 ? Math.max(0, questions.length - 1) : firstUnanswered,
  );

  const answersByQuestionId = useMemo(
    () => new Map(initialAnswers.filter((a) => a.questionId).map((a) => [a.questionId, a])),
    [initialAnswers],
  );

  const total = questions.length;
  const question = questions[currentIndex];
  const existingAnswer = question ? answersByQuestionId.get(question.id) ?? null : null;

  // Local, controlled per-question draft text -- reset whenever the
  // current question changes so switching questions with Previous/Next
  // shows that question's own saved-or-in-progress answer, not the
  // previous question's draft (AS-114's "one question at a time" still
  // applies to the input itself, not just the prompt). Reset happens
  // during render (the "adjusting state when a prop changes" pattern),
  // not in an effect, so there's no extra render pass and no
  // set-state-in-effect lint violation.
  const [renderedQuestionId, setRenderedQuestionId] = useState(question?.id);
  const [draft, setDraft] = useState<{ text: string | null; options: string[] | null }>({
    text: existingAnswer?.answerText ?? "",
    options: existingAnswer?.answerOptions ?? null,
  });
  // F060 (AS-123): tracks whether the current question failed required
  // validation on the last Next attempt, so the inline error can render.
  const [validationError, setValidationError] = useState(false);

  // F061 (AS-124/AS-125/AS-126): submit state for the whole questionnaire.
  // `submitted` flips true on success and never flips back to false --
  // AS-126 means the form stays fully editable afterwards (nothing here
  // disables AnswerInput or the autosave wiring), it's purely a status
  // message shown alongside the still-editable form.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (question?.id !== renderedQuestionId) {
    setRenderedQuestionId(question?.id);
    setDraft({
      text: existingAnswer?.answerText ?? "",
      options: existingAnswer?.answerOptions ?? null,
    });
    setValidationError(false);
  }

  // AS-116: no save control anywhere in this component -- saveFn fires
  // purely from `draft` changing, debounced. AS-118 is then satisfied
  // server-side: saveBriefAnswer actually writes the row, so a later
  // reload's initialAnswers (re-fetched via getBriefForClient) includes it.
  const { saving, lastSaved } = useAutosave(draft, async (value) => {
    if (!briefId || !question) return;
    const text = value.text != null && value.text.trim() === "" ? null : value.text;
    const optionsList = value.options && value.options.length > 0 ? value.options : null;
    await saveBriefAnswer(briefId, question.id, text, optionsList);
  });

  if (!question) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  const handleNext = () => {
    if (question.required && !isAnswered(question, draft)) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setCurrentIndex((i) => Math.min(total - 1, i + 1));
  };

  // AS-124: every required question must be answered before submit is
  // allowed. The current question's in-progress draft takes precedence
  // over its possibly-stale saved answer (autosave may still be
  // in-flight/debounced); every other question is checked against its
  // last-saved answer from `initialAnswers`.
  const allRequiredAnswered = questions.every((q) => {
    if (!q.required) return true;
    if (q.id === question.id) return isAnswered(q, draft);
    const saved = answersByQuestionId.get(q.id);
    return isAnswered(q, {
      text: saved?.answerText ?? "",
      options: saved?.answerOptions ?? null,
    });
  });

  const handleSubmit = async () => {
    if (!briefId) return;
    if (!allRequiredAnswered) {
      setSubmitError("Please answer all required questions before submitting.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const result = await submitBrief(briefId);
    setSubmitting(false);
    if (!result.success) {
      setSubmitError(result.error ?? "Couldn't submit this brief.");
      return;
    }
    setSubmitted(true);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="portal-questionnaire">
      <QuestionnaireProgress currentIndex={currentIndex} total={total} />

      <div className="flex flex-col gap-3" data-testid="questionnaire-question">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-medium text-foreground">{question.prompt}</h2>
          {question.required && (
            <Badge variant="outline" data-testid="questionnaire-required-badge">
              Required
            </Badge>
          )}
        </div>

        {question.helpText && (
          <p className="text-sm text-muted-foreground">{question.helpText}</p>
        )}

        {existingAnswer?.hasRevisions && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="questionnaire-edited-indicator"
          >
            You&apos;ve edited this answer
          </p>
        )}

        <AnswerInput
          question={question}
          value={draft.text}
          selectedOptions={draft.options ?? []}
          onChange={(text, options) => {
            setDraft({ text, options });
            setValidationError(false);
          }}
        />

        {validationError && (
          <p className="text-sm text-destructive" data-testid="questionnaire-required-error">
            This question is required
          </p>
        )}

        <p
          className="font-mono text-xs text-muted-foreground"
          data-testid="questionnaire-autosave-status"
          aria-live="polite"
        >
          {saving ? "Saving…" : lastSaved ? "Saved" : ""}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isFirst}
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        <Button type="button" disabled={isLast} onClick={handleNext}>
          Next
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="questionnaire-submit">
        {submitted ? (
          <p className="text-sm text-foreground" data-testid="questionnaire-submitted-message">
            Brief submitted. You can still edit your answers.
          </p>
        ) : (
          <>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!briefId || submitting}
              data-testid="questionnaire-submit-button"
            >
              {submitting ? "Submitting…" : "Submit"}
            </Button>
            {submitError && (
              <p className="text-sm text-destructive" data-testid="questionnaire-submit-error">
                {submitError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
