"use client";

import { useMemo, useState } from "react";

import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
export function PortalQuestionnaire({
  questions,
  initialAnswers,
}: {
  questions: BriefQuestion[];
  initialAnswers: BriefAnswer[];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const answersByQuestionId = useMemo(
    () => new Map(initialAnswers.filter((a) => a.questionId).map((a) => [a.questionId, a])),
    [initialAnswers],
  );

  const total = questions.length;
  const question = questions[currentIndex];
  const existingAnswer = question ? answersByQuestionId.get(question.id) ?? null : null;

  if (!question) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  return (
    <div className="flex flex-col gap-6" data-testid="portal-questionnaire">
      <p className="text-sm text-muted-foreground" data-testid="questionnaire-progress">
        Question {currentIndex + 1} of {total}
      </p>

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

        {/* Stub input -- real per-answerType widgets land in F059. */}
        <Textarea
          data-testid="questionnaire-answer-stub"
          defaultValue={existingAnswer?.answerText ?? ""}
          placeholder="Your answer"
          rows={4}
        />
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
