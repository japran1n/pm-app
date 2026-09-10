"use client";

// F050 (AS-102, AS-103, AS-104, AS-105): renders the questionnaire's
// questions with their attributes visible (category, answer type,
// required, help text), and lets the team edit a question inline via
// <QuestionForm>. A thin client wrapper rather than a Server Component
// because editing needs local per-row open/closed state -- the page that
// renders this still does the actual data fetch server-side (see
// app/(workspace)/.../brief/page.tsx) and passes `questions` down as a
// plain prop, same as team-answers-view.tsx's pattern.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, X } from "lucide-react";

import type { BriefQuestion, BriefQuestionAnswerType } from "@/lib/queries/brief";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionForm } from "@/components/brief/question-form";

const ANSWER_TYPE_LABEL: Record<BriefQuestionAnswerType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
};

export function QuestionList({
  projectId,
  questions,
}: {
  projectId: string;
  questions: BriefQuestion[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No questions yet. Add one to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {questions.map((question) => (
        <li key={question.id} className="rounded-md border border-border bg-card p-4 shadow-xs">
          {editingId === question.id ? (
            <QuestionForm
              projectId={projectId}
              question={question}
              onSaved={() => {
                setEditingId(null);
                router.refresh();
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-foreground">
                  {question.prompt}
                  {question.required ? (
                    <span className="ml-1 text-destructive" aria-label="Required">
                      *
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {question.category ? <Badge variant="outline">{question.category}</Badge> : null}
                  <Badge variant="secondary">{ANSWER_TYPE_LABEL[question.answerType]}</Badge>
                  {question.required ? <Badge variant="warning">Required</Badge> : null}
                </div>
                {question.helpText ? (
                  <p className="text-sm text-muted-foreground">{question.helpText}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Edit question: ${question.prompt}`}
                onClick={() => setEditingId(question.id)}
              >
                {editingId === question.id ? (
                  <X className="size-4" aria-hidden="true" />
                ) : (
                  <Pencil className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
