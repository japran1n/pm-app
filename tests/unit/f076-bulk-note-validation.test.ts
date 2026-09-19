// F076 (missions/20260919-150607): AS-073 requires the 200-character note
// cap to be enforced on the schema the LIVE bulk path actually uses
// (`bulkDisciplineEstimateEntrySchema` / `setDisciplineEstimatesBulkSchema`
// in lib/validation/architecture.ts, called from
// setDisciplineEstimatesBulk -- the popover's only write path since F021).
// A prior version of this suite only exercised the singular
// `setDisciplineEstimateSchema`, which is never called by the popover, so
// a regression on the bulk schema's note validation could ship unnoticed.
// This file locks the bulk schema itself down.
//
// AS-073: a discipline estimate note over 200 characters is rejected with
// a human-readable "N characters over" message; a note at or under 200
// characters is accepted.

import { describe, expect, it } from "vitest";
import {
  bulkDisciplineEstimateEntrySchema,
  setDisciplineEstimatesBulkSchema,
  NOTE_MAX_LENGTH,
} from "@/lib/validation/architecture";

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";

describe("bulkDisciplineEstimateEntrySchema note validation (AS-073)", () => {
  it("test_AS_073_accepts_a_note_at_exactly_the_200_character_limit", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH);
    const result = bulkDisciplineEstimateEntrySchema.safeParse({
      discipline: "design",
      input: "1h",
      note,
    });
    expect(result.success).toBe(true);
  });

  it("test_AS_073_rejects_a_note_one_character_over_the_200_character_limit", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH + 1);
    const result = bulkDisciplineEstimateEntrySchema.safeParse({
      discipline: "design",
      input: "1h",
      note,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toMatch(/1 character over the 200-character limit/);
    }
  });

  it("test_AS_073_reports_how_many_characters_over_the_limit_a_long_note_is", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH + 15);
    const result = bulkDisciplineEstimateEntrySchema.safeParse({
      discipline: "development",
      input: "30m",
      note,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toMatch(/15 characters over the 200-character limit/);
    }
  });

  it("test_AS_073_setDisciplineEstimatesBulkSchema_rejects_when_any_entry_note_is_too_long", () => {
    const result = setDisciplineEstimatesBulkSchema.safeParse({
      taskId: TASK_ID,
      entries: [
        { discipline: "design", input: "1h", note: "fine" },
        { discipline: "qa", input: "30m", note: "a".repeat(NOTE_MAX_LENGTH + 1) },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("test_AS_073_setDisciplineEstimatesBulkSchema_accepts_all_entries_within_the_limit", () => {
    const result = setDisciplineEstimatesBulkSchema.safeParse({
      taskId: TASK_ID,
      entries: [
        { discipline: "design", input: "1h", note: "a".repeat(NOTE_MAX_LENGTH) },
        { discipline: "qa", input: "30m", note: "" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
