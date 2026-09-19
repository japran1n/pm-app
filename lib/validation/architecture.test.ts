import { describe, expect, it } from "vitest";
import {
  disciplineEstimateNoteSchema,
  setDisciplineEstimateSchema,
  NOTE_MAX_LENGTH,
} from "./architecture";

describe("AS-073 discipline estimate note 200-char validation", () => {
  it("test_AS_073_note_at_200_chars_is_accepted", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH);
    const result = disciplineEstimateNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it("test_AS_073_note_over_200_chars_is_rejected_with_readable_message", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH + 5);
    const result = disciplineEstimateNoteSchema.safeParse(note);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      // Human-readable: mentions how many characters over the limit, not a
      // generic zod "too_big" message.
      expect(message).toMatch(/5 characters over the 200-character limit/i);
      expect(message.toLowerCase()).not.toContain("too_big");
    }
  });

  it("test_AS_073_note_one_char_over_uses_singular_wording", () => {
    const note = "a".repeat(NOTE_MAX_LENGTH + 1);
    const result = disciplineEstimateNoteSchema.safeParse(note);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/1 character over/i);
    }
  });

  it("test_AS_073_undefined_note_is_optional_and_valid", () => {
    const result = disciplineEstimateNoteSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("test_AS_073_empty_note_is_valid", () => {
    const result = disciplineEstimateNoteSchema.safeParse("");
    expect(result.success).toBe(true);
  });

  it("test_AS_073_setDisciplineEstimateSchema_rejects_long_note", () => {
    const result = setDisciplineEstimateSchema.safeParse({
      taskId: "00000000-0000-0000-0000-000000000000",
      discipline: "design",
      input: "2h",
      note: "a".repeat(NOTE_MAX_LENGTH + 10),
    });
    expect(result.success).toBe(false);
  });
});
