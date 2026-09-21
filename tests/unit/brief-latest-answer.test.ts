import { describe, expect, it } from "vitest";
import { pickLatestAnsweredRow } from "@/lib/brief/latest-answer";

const qs = new Map([
  ["q1", { answerType: "short_text" as const }],
  ["q2", { answerType: "short_text" as const }],
  ["q3", { answerType: "single_choice" as const }],
]);
const row = (questionId: string, updatedAt: string, answerText: string | null, answerOptions: string[] | null = null) => ({
  questionId, updatedAt, answerText, answerOptions,
});

describe("BR-022/BR-023: latest answered row", () => {
  it("test_BR_022_ignores_newer_blank_rows", () => {
    const a = row("q1", "2026-09-01T00:00:00Z", "hi");
    const blank = row("q2", "2026-09-05T00:00:00Z", "  ");
    expect(pickLatestAnsweredRow([a, blank], qs)).toBe(a);
  });
  it("test_BR_023_compares_as_dates_not_strings", () => {
    // Lexically "…T10:00:00+02:00" > "…T09:00:00Z", but it is the earlier instant.
    const early = row("q1", "2026-09-01T10:00:00+02:00", "a");
    const late = row("q2", "2026-09-01T09:00:00Z", "b");
    expect(pickLatestAnsweredRow([early, late], qs)).toBe(late);
  });
  it("test_BR_023_choice_rows_and_null_result", () => {
    const c = row("q3", "2026-09-02T00:00:00Z", null, ["x"]);
    expect(pickLatestAnsweredRow([c], qs)).toBe(c);
    expect(pickLatestAnsweredRow([row("q3", "2026-09-02T00:00:00Z", null, [])], qs)).toBeNull();
    expect(pickLatestAnsweredRow([], qs)).toBeNull();
  });
});
