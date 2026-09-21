import { isBriefAnswerAnswered, type AnswerValue } from "@/lib/brief/is-answered";
import type { BriefQuestion } from "@/lib/queries/brief";

type Row = AnswerValue & { questionId: string | null; updatedAt: string };

// Newest ANSWERED row only (cleared/empty rows don't count as "last modified"),
// compared as Date values rather than lexically so differing ISO offsets or
// precisions order correctly. Rows with unparseable timestamps are skipped.
export function pickLatestAnsweredRow<T extends Row>(
  rows: T[],
  questionsById: Map<string, Pick<BriefQuestion, "answerType">>,
): T | null {
  let latest: T | null = null;
  let latestTime = -Infinity;
  for (const row of rows) {
    const question = row.questionId ? questionsById.get(row.questionId) : undefined;
    if (!question || !isBriefAnswerAnswered(question, row)) continue;
    const time = new Date(row.updatedAt).getTime();
    if (Number.isNaN(time)) continue;
    if (time > latestTime) {
      latest = row;
      latestTime = time;
    }
  }
  return latest;
}
