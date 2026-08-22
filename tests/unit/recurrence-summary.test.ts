// Unit tests for F179's plain-language recurrence summary
// (lib/recurrence/summarize-rule.ts). Derived from the assertion text
// (AS-317: "a recurrence indicator appears on the card", AS-318: "a rule
// can be edited ... the stored rule" — the summary is the exact, user-
// facing proof of what's stored) and this feature's own Notes ("the
// plain-language summary is the only place users verify what they
// configured — make it exact"), not from the implementation.

import { describe, expect, it } from "vitest";

import { summarizeRecurrenceRule } from "@/lib/recurrence/summarize-rule";

describe("summarizeRecurrenceRule (F179)", () => {
  it("test_AS_317_daily_interval_one_reads_every_day", () => {
    expect(
      summarizeRecurrenceRule({ freq: "daily", interval: 1 }),
    ).toBe("Every day");
  });

  it("test_AS_317_weekly_interval_two_with_until_reads_every_2_weeks_until_date", () => {
    expect(
      summarizeRecurrenceRule({
        freq: "weekly",
        interval: 2,
        until: "2026-09-30",
      }),
    ).toBe("Every 2 weeks until Sep 30");
  });

  it("test_AS_317_monthly_interval_one_reads_every_month", () => {
    expect(
      summarizeRecurrenceRule({ freq: "monthly", interval: 1 }),
    ).toBe("Every month");
  });

  it("test_AS_317_monthly_interval_three_reads_every_3_months", () => {
    expect(
      summarizeRecurrenceRule({ freq: "monthly", interval: 3 }),
    ).toBe("Every 3 months");
  });

  it("test_AS_317_every_n_days_interval_five_reads_every_5_days", () => {
    expect(
      summarizeRecurrenceRule({ freq: "every_n_days", interval: 5 }),
    ).toBe("Every 5 days");
  });

  it("test_AS_317_no_until_omits_the_until_clause", () => {
    const summary = summarizeRecurrenceRule({ freq: "daily", interval: 3 });
    expect(summary).toBe("Every 3 days");
    expect(summary).not.toContain("until");
  });

  it("test_AS_318_null_rule_returns_null_no_indicator_text_invented", () => {
    expect(summarizeRecurrenceRule(null)).toBeNull();
    expect(summarizeRecurrenceRule(undefined)).toBeNull();
  });

  it("test_AS_318_malformed_interval_returns_null_rather_than_throwing", () => {
    expect(
      summarizeRecurrenceRule({ freq: "daily", interval: 0 }),
    ).toBeNull();
    expect(
      summarizeRecurrenceRule({ freq: "daily", interval: 1.5 }),
    ).toBeNull();
  });

  it("test_AS_318_unsupported_freq_returns_null_rather_than_throwing", () => {
    expect(
      // @ts-expect-error deliberately malformed input
      summarizeRecurrenceRule({ freq: "yearly", interval: 1 }),
    ).toBeNull();
  });

  it("test_AS_318_malformed_until_degrades_to_the_freq_clause_alone", () => {
    expect(
      summarizeRecurrenceRule({
        freq: "daily",
        interval: 1,
        until: "not-a-date",
      }),
    ).toBe("Every day");
  });
});
