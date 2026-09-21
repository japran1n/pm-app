"use client";

// F056 (missions/20260910-182104, AS-115): visual progress indicator for
// the section-per-step portal questionnaire. Shows "Question N of M"
// text plus a filled progress bar so respondents can see how far through
// the question set they are.
export function QuestionnaireProgress({
  currentIndex,
  total,
  isReview = false,
}: {
  currentIndex: number;
  total: number;
  // F010: the review step follows the last section; label it "Review".
  isReview?: boolean;
}) {
  const current = isReview ? total : currentIndex + 1;
  const fraction = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;

  return (
    <div className="flex flex-col gap-2" data-testid="questionnaire-progress">
      <p
        className="text-sm text-muted-foreground"
        data-testid="questionnaire-progress-text"
      >
        {isReview ? "Review" : `Step ${current} of ${total}`}
      </p>
      <div
        className="h-1.5 w-full rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        data-testid="questionnaire-progress-bar"
      >
        <div
          className="h-1.5 rounded-full bg-primary transition-all duration-200"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
