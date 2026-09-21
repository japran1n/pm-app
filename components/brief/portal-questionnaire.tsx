"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";
import { saveBriefAnswer, submitBrief } from "@/lib/actions/brief";
import { useAutosave } from "@/lib/hooks/use-autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionnaireProgress } from "@/components/brief/questionnaire-progress";
import { PortalBriefReview } from "@/components/brief/portal-brief-review";
import { AnswerInput } from "@/components/brief/answer-input";
import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { groupBySection } from "@/lib/brief/group-by-section";

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
  return isBriefAnswerAnswered(question, {
    answerText: draft.text,
    answerOptions: draft.options,
  });
}

const SAVE_FAILED_MESSAGE =
  "Some answers couldn't be saved. Fix the connection and try again before submitting.";

type Draft = { text: string | null; options: string[] | null };

// F009 (missions/20260921-brief-redesign, BR-040..BR-047): the wizard now shows
// one SECTION per step (all of the section's questions at once). Each question
// owns its own debounced autosave (same saveBriefAnswer call as before); the
// section-level indicator aggregates them. `currentSectionIndex` is the only
// navigation state so a review step (index === sections.length) can be added
// later without restructuring.
function QuestionField({
  question,
  existingAnswer,
  draft,
  onDraftChange,
  briefId,
  isLocked,
  showError,
  onSaveState,
  trackSave,
  onSaveResult,
  registerFlush,
}: {
  question: BriefQuestion;
  existingAnswer: BriefAnswer | null;
  draft: Draft;
  onDraftChange: (id: string, draft: Draft) => void;
  briefId?: string | null;
  isLocked: boolean;
  showError: boolean;
  onSaveState: (id: string, saving: boolean, saved: boolean) => void;
  trackSave: (p: Promise<unknown>) => void;
  onSaveResult: (id: string, ok: boolean) => void;
  registerFlush: (id: string, flush: (() => Promise<boolean>) | null) => void;
}) {
  const { saving, lastSaved, error, flush } = useAutosave(
    draft,
    async (value) => {
      if (!briefId || isLocked) return;
      const text =
        value.text != null && value.text.trim() === "" ? null : value.text;
      const optionsList =
        value.options && value.options.length > 0 ? value.options : null;
      const p = saveBriefAnswer(briefId, question.id, text, optionsList);
      trackSave(p);
      try {
        const result = await p;
        // saveBriefAnswer resolves { success:false } rather than throwing.
        onSaveResult(question.id, result?.success !== false);
        return result;
      } catch (e) {
        onSaveResult(question.id, false);
        throw e;
      }
    },
  );
  const saved = lastSaved !== null;
  useEffect(() => {
    onSaveState(question.id, saving, saved);
  }, [question.id, saving, saved, onSaveState]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    registerFlush(question.id, () => flushRef.current());
    return () => registerFlush(question.id, null);
  }, [question.id, registerFlush]);
  const failed = error !== null;

  return (
    <div className="flex flex-col gap-3" data-testid="questionnaire-question">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-foreground">
          {question.prompt}
        </h3>
        {question.required && (
          <Badge variant="outline" data-testid="questionnaire-required-badge">
            Required
          </Badge>
        )}
      </div>

      {question.helpText && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="questionnaire-help-text"
        >
          {question.helpText}
        </p>
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
        onChange={(text, options) =>
          onDraftChange(question.id, { text, options })
        }
        disabled={isLocked}
      />

      {failed && (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="questionnaire-save-error"
        >
          Couldn&apos;t save this answer
        </p>
      )}

      {showError && (
        <p
          className="text-sm text-destructive"
          data-testid="questionnaire-required-error"
        >
          This question is required
        </p>
      )}
    </div>
  );
}

export function PortalQuestionnaire({
  questions,
  initialAnswers,
  briefId,
  briefState,
}: {
  questions: BriefQuestion[];
  initialAnswers: BriefAnswer[];
  briefId?: string | null;
  // F076 (AS-148/AS-149/AS-150): once the brief is approved, every answer
  // input renders disabled and a banner explains why.
  briefState?: "draft" | "submitted" | "approved" | null;
}) {
  const isLocked = briefState === "approved";
  const sections = useMemo(() => groupBySection(questions), [questions]);

  const answersByQuestionId = useMemo(
    () =>
      new Map(
        initialAnswers
          .filter((a) => a.questionId)
          .map((a) => [a.questionId, a]),
      ),
    [initialAnswers],
  );

  // F058 (AS-117), section-level: resume at the first section that still has
  // an unanswered question; if all are answered, land on the last section.
  const [currentSectionIndex, setCurrentSectionIndex] = useState(() => {
    const idx = sections.findIndex((sec) =>
      sec.questions.some((q) => {
        const a = answersByQuestionId.get(q.id);
        return !(
          a &&
          (Boolean(a.answerText) ||
            (a.answerOptions && a.answerOptions.length > 0))
        );
      }),
    );
    return idx === -1 ? Math.max(0, sections.length - 1) : idx;
  });

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      questions.map((q) => {
        const a = answersByQuestionId.get(q.id);
        return [
          q.id,
          { text: a?.answerText ?? "", options: a?.answerOptions ?? null },
        ];
      }),
    ),
  );
  const [showErrors, setShowErrors] = useState(false);
  // Required questions left blank in the section the user just advanced past.
  const [skippedRequired, setSkippedRequired] = useState(0);
  const [saveStates, setSaveStates] = useState<
    Record<string, { saving: boolean; saved: boolean }>
  >({});

  // In-flight saves (including ones flushed on unmount / section change) so
  // Submit can wait for them and never race a lost edit.
  const pendingSavesRef = useRef<Set<Promise<unknown>>>(new Set());
  const trackSave = useCallback((p: Promise<unknown>) => {
    const set = pendingSavesRef.current;
    const tracked = p.catch(() => undefined).finally(() => set.delete(tracked));
    set.add(tracked);
  }, []);

  // Questions whose most recent write failed (including ones that failed after
  // their field unmounted). Submit is blocked while any remain.
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const failedIdsRef = useRef<Set<string>>(new Set());
  const handleSaveResult = useCallback((id: string, ok: boolean) => {
    const cur = failedIdsRef.current;
    if (ok) cur.delete(id);
    else cur.add(id);
    setFailedIds((prev) => {
      if (prev.has(id) === !ok) return prev;
      const next = new Set(prev);
      if (ok) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Mounted fields register a flush so section change / Submit can write any
  // pending edit explicitly instead of relying on unmount.
  const flushersRef = useRef<Map<string, () => Promise<boolean>>>(new Map());
  const registerFlush = useCallback(
    (id: string, flush: (() => Promise<boolean>) | null) => {
      if (flush) flushersRef.current.set(id, flush);
      else flushersRef.current.delete(id);
    },
    [],
  );
  const flushAll = useCallback(async () => {
    await Promise.all(
      Array.from(flushersRef.current.values()).map((f) => f()),
    );
    await Promise.all(Array.from(pendingSavesRef.current));
  }, []);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleDraftChange = useCallback((id: string, draft: Draft) => {
    setDrafts((prev) => ({ ...prev, [id]: draft }));
    setShowErrors(false);
  }, []);

  const handleSaveState = useCallback(
    (id: string, saving: boolean, saved: boolean) => {
      setSaveStates((prev) => {
        const cur = prev[id];
        if (cur && cur.saving === saving && cur.saved === saved) return prev;
        return { ...prev, [id]: { saving, saved } };
      });
    },
    [],
  );

  const total = sections.length;
  // F010: index === sections.length is the review step (BR-043).
  const isReview = currentSectionIndex === total;
  const section = sections[currentSectionIndex];
  if (!section && !isReview) return null;
  const isFirst = currentSectionIndex === 0;

  const draftFor = (q: BriefQuestion): Draft =>
    drafts[q.id] ?? { text: "", options: null };
  const isUnansweredRequired = (q: BriefQuestion) =>
    q.required && !isAnswered(q, draftFor(q));

  // Aggregated autosave indicator for the current section (BR-042).
  const sectionStates = (section?.questions ?? []).map((q) => saveStates[q.id]);
  const anySaving = sectionStates.some((s) => s?.saving);
  const anySaved = sectionStates.some((s) => s?.saved);
  const anyFailed = failedIds.size > 0;

  // BR-041: Next never hard-blocks. Unanswered REQUIRED questions produce an
  // inline non-blocking warning, the review step lists them, and Submit is
  // the real gate.
  const sectionMissingCount = section
    ? section.questions.filter(isUnansweredRequired).length
    : 0;
  const handleNext = () => {
    void flushAll();
    setShowErrors(false);
    setSkippedRequired(sectionMissingCount);
    setCurrentSectionIndex((i) => Math.min(total, i + 1));
  };

  const handleBack = () => {
    void flushAll();
    setShowErrors(false);
    setSkippedRequired(0);
    setCurrentSectionIndex((i) => Math.max(0, i - 1));
  };

  // AS-124: every required question must be answered before submit.
  const allRequiredAnswered = !questions.some(isUnansweredRequired);

  const handleSubmit = async () => {
    if (!briefId) return;
    if (!allRequiredAnswered) {
      setSubmitError("Please answer all required questions before submitting.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    // Explicitly flush pending edits and wait for in-flight autosaves.
    await flushAll();
    if (failedIdsRef.current.size > 0) {
      setSubmitting(false);
      setSubmitError(SAVE_FAILED_MESSAGE);
      return;
    }
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
      {isLocked && (
        <p
          className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
          data-testid="questionnaire-approved-banner"
        >
          This brief has been approved. Answers are locked.
        </p>
      )}

      <QuestionnaireProgress
        currentIndex={currentSectionIndex}
        total={total}
        isReview={isReview}
      />

      {skippedRequired > 0 && (
        <p
          className="text-sm text-destructive"
          role="status"
          data-testid="questionnaire-next-warning"
        >
          {skippedRequired} required{" "}
          {skippedRequired === 1 ? "question was" : "questions were"} left
          unanswered in the previous section. You can continue, but they must
          be answered before you can submit.
        </p>
      )}

      {isReview ? (
        <PortalBriefReview
          sections={sections.map((sec, sectionIndex) => ({
            name: sec.name,
            sectionIndex,
            questions: sec.questions,
            // Live drafts, so unsaved-but-typed values show up in the review.
            answers: new Map(
              sec.questions.map((q) => {
                const d = draftFor(q);
                return [
                  q.id,
                  { answerText: d.text, answerOptions: d.options },
                ] as const;
              }),
            ),
          }))}
          missingCount={questions.filter(isUnansweredRequired).length}
          onEditSection={(i) => {
            void flushAll();
            setShowErrors(false);
            setSkippedRequired(0);
            setCurrentSectionIndex(i);
          }}
        />
      ) : (
        <section
          className="flex flex-col gap-6"
          data-testid="questionnaire-section"
        >
          <h2
            className="text-lg font-semibold text-foreground"
            data-testid="questionnaire-section-title"
          >
            {section.name}
          </h2>

          {section.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              existingAnswer={answersByQuestionId.get(q.id) ?? null}
              draft={draftFor(q)}
              onDraftChange={handleDraftChange}
              briefId={briefId}
              isLocked={isLocked}
              showError={showErrors && isUnansweredRequired(q)}
              onSaveState={handleSaveState}
              trackSave={trackSave}
              onSaveResult={handleSaveResult}
              registerFlush={registerFlush}
            />
          ))}

          <p
            className="font-mono text-xs text-muted-foreground"
            data-testid="questionnaire-autosave-status"
            aria-live="polite"
          >
            {anySaving
              ? "Saving…"
              : anyFailed
                ? "Couldn't save"
                : anySaved
                  ? "Saved"
                  : ""}
          </p>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isFirst}
          onClick={handleBack}
        >
          Previous
        </Button>
        {!isReview && (
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        )}
      </div>

      {isReview && (
        <div
          className="flex flex-col gap-2 border-t border-border pt-4"
          data-testid="questionnaire-submit"
        >
          {submitted ? (
            <p
              className="text-sm text-foreground"
              data-testid="questionnaire-submitted-message"
            >
              Brief submitted. You can still edit your answers.
            </p>
          ) : (
            <>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={
                  !briefId || submitting || !allRequiredAnswered || anyFailed
                }
                data-testid="questionnaire-submit-button"
              >
                {submitting ? "Submitting…" : "Submit"}
              </Button>
              {anyFailed && !submitError && (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="questionnaire-unsaved-warning"
                >
                  {SAVE_FAILED_MESSAGE}
                </p>
              )}
              {submitError && (
                <p
                  className="text-sm text-destructive"
                  data-testid="questionnaire-submit-error"
                >
                  {submitError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
