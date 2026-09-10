"use client";

import { useEffect, useMemo, useState } from "react";

import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";
import { saveBriefAnswer } from "@/lib/actions/brief";
import { useAutosave } from "@/lib/hooks/use-autosave";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuestionnaireProgress } from "@/components/brief/questionnaire-progress";

// F055 (missions/20260910-182104, AS-113, AS-114): the client-facing
// questionnaire. AS-114 ("one question at a time") is the whole reason
// this is a Client Component rather than a static server-rendered list --
// `currentIndex` is local UI state, not anything that needs to survive a
// reload or round-trip through the server.
//
// The answer input below is a deliberate stub: F059's clarified spec owns
// the real per-`answerType` input widgets (short_text/long_text/
// single_choice/multi_choice) and the write path that persists them. This
// component only needs to prove one question renders at a time and that
// existing answers (via `initialAnswers`) are visible -- so the textarea
// here is pre-filled read-only-in-spirit but left editable and unwired,
// matching the spec's "just a simple textarea stub" instruction. Wiring
// submission is explicitly out of scope for F055.
// F057 (AS-116, AS-118): briefId is optional so F055's original render
// tests (no briefId passed) keep passing -- autosave simply has nothing
// to persist to without a brief to attach the answer to, which never
// happens on the real portal route now that the page below always passes
// the loaded brief's id.
export function PortalQuestionnaire({
  questions,
  initialAnswers,
  briefId,
}: {
  questions: BriefQuestion[];
  initialAnswers: BriefAnswer[];
  briefId?: string | null;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

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
  // applies to the input itself, not just the prompt).
  const [draftText, setDraftText] = useState(existingAnswer?.answerText ?? "");

  useEffect(() => {
    setDraftText(existingAnswer?.answerText ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id]);

  // AS-116: no save control anywhere in this component -- saveFn fires
  // purely from `draftText` changing, debounced. AS-118 is then satisfied
  // server-side: saveBriefAnswer actually writes the row, so a later
  // reload's initialAnswers (re-fetched via getBriefForClient) includes it.
  const { saving, lastSaved } = useAutosave(draftText, async (value) => {
    if (!briefId || !question) return;
    await saveBriefAnswer(briefId, question.id, value.trim() === "" ? null : value, null);
  });

  if (!question) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

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

        {/* Stub input -- real per-answerType widgets land in F059. Autosave
            (F057) is already wired here so typed answers persist regardless
            of which widget eventually replaces this textarea. */}
        <Textarea
          data-testid="questionnaire-answer-stub"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="Your answer"
          rows={4}
        />

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
        <Button
          type="button"
          disabled={isLast}
          onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
