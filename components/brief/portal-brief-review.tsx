"use client";

import type { BriefQuestion } from "@/lib/queries/brief";
import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// F010 (missions/20260921-brief-redesign, BR-043, BR-044): the final wizard
// step. Lists every answer grouped by section with an "Edit" button per
// section, and flags required questions that are still unanswered.
//
// `answers` is keyed by question id and only needs the value fields, so the
// parent can pass live draft state (BriefAnswer rows satisfy this shape too).
export type ReviewAnswer = {
  answerText: string | null;
  answerOptions: string[] | null;
};

export type ReviewSection = {
  name: string;
  sectionIndex: number;
  questions: BriefQuestion[];
  answers: Map<string, ReviewAnswer>;
};

function answerDisplay(a: ReviewAnswer | undefined): string | null {
  if (!a) return null;
  if (a.answerOptions && a.answerOptions.length > 0)
    return a.answerOptions.join(", ");
  if (a.answerText && a.answerText.trim() !== "") return a.answerText;
  return null;
}

export function PortalBriefReview({
  sections,
  onEditSection,
}: {
  sections: ReviewSection[];
  onEditSection: (sectionIndex: number) => void;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="portal-brief-review">
      <h2 className="text-lg font-semibold text-foreground">
        Review your answers
      </h2>

      {sections.map((section) => (
        <section
          key={section.sectionIndex}
          className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 shadow-xs"
          data-testid="review-section"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">
              {section.name}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEditSection(section.sectionIndex)}
              aria-label={`Edit ${section.name}`}
              data-testid="review-edit-button"
            >
              Edit
            </Button>
          </div>

          {section.questions.map((q) => {
            const answer = section.answers.get(q.id);
            const value = isBriefAnswerAnswered(q, answer)
              ? answerDisplay(answer)
              : null;
            const missing = q.required && value === null;
            return (
              <div
                key={q.id}
                className={
                  missing
                    ? "flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3"
                    : "flex flex-col gap-1"
                }
                data-testid="review-question"
                data-unanswered-required={missing ? "true" : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {q.prompt}
                  </p>
                  {q.required && <Badge variant="outline">Required</Badge>}
                </div>
                {value !== null ? (
                  <p
                    className="whitespace-pre-wrap text-sm text-muted-foreground"
                    data-testid="review-answer"
                  >
                    {value}
                  </p>
                ) : missing ? (
                  <p
                    className="text-sm text-destructive"
                    data-testid="review-not-answered"
                  >
                    Not answered
                  </p>
                ) : (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="review-empty"
                  >
                    —
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
