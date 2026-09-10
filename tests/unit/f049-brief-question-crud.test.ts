// Unit tests for F049 (lib/validation/brief.ts, lib/actions/brief.ts):
// covers AS-101 (a team member can add a question) and AS-112 (a question
// cannot be saved with empty prompt text). Schema tests derive from the
// assertion text, not from the implementation: they assert the shape of
// what may be saved, independent of how createBriefQuestion happens to
// call Supabase.
//
// Actions themselves (createBriefQuestion/updateBriefQuestion/
// deleteBriefQuestion) call `createClient()` from `@/lib/supabase/server`,
// which needs a real request context (cookies) -- exercising them against
// a live Supabase project is an integration concern, matching F048's
// documented precedent (tests/unit/f048-brief-query.test.ts). This file
// verifies the Zod validation boundary (the actual AS-112 enforcement
// this feature adds before ever reaching the DB) and the module's public
// surface.

import { describe, expect, it } from "vitest";
import * as briefActions from "@/lib/actions/brief";
import {
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
} from "@/lib/validation/brief";

describe("F049: lib/actions/brief.ts exports the CRUD surface", () => {
  it("exports createBriefQuestion", () => {
    expect(typeof briefActions.createBriefQuestion).toBe("function");
  });

  it("exports updateBriefQuestion", () => {
    expect(typeof briefActions.updateBriefQuestion).toBe("function");
  });

  it("exports deleteBriefQuestion", () => {
    expect(typeof briefActions.deleteBriefQuestion).toBe("function");
  });
});

describe("F049 AS-112: a question cannot be saved with empty prompt text", () => {
  it("rejects an empty prompt", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "",
      category: "Logistics",
      answerType: "short_text",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only prompt (trimmed to empty)", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "   ",
      category: "Logistics",
      answerType: "short_text",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing prompt field entirely", () => {
    const result = createQuestionSchema.safeParse({
      category: "Logistics",
      answerType: "short_text",
    });
    expect(result.success).toBe(false);
  });

  it("update schema also rejects an empty prompt when prompt is included", () => {
    const result = updateQuestionSchema.safeParse({ prompt: "" });
    expect(result.success).toBe(false);
  });
});

describe("F049 AS-101: a team member can add a question -- valid shapes accepted", () => {
  it("accepts a minimal valid question (prompt, category, answerType only)", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "What is the target launch date?",
      category: "Timeline",
      answerType: "short_text",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required).toBe(false);
    }
  });

  it("accepts a full question with help text, required flag, and options", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "Which platforms should this ship on?",
      category: "Scope",
      answerType: "multi_choice",
      helpText: "Select all that apply.",
      required: true,
      options: ["Web", "iOS", "Android"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual(["Web", "iOS", "Android"]);
      expect(result.data.required).toBe(true);
    }
  });

  it("rejects an invalid answerType not in the DB's CHECK constraint enum", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "Anything else?",
      category: "Misc",
      answerType: "essay",
    });
    expect(result.success).toBe(false);
  });

  it("trims the prompt so leading/trailing whitespace never reaches the DB", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "  What is the budget?  ",
      category: "Budget",
      answerType: "short_text",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe("What is the budget?");
    }
  });
});

describe("F049: updateQuestionSchema accepts a genuine partial update", () => {
  it("accepts a single-field update with everything else omitted", () => {
    const result = updateQuestionSchema.safeParse({ required: true });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (no-op update shape is still schema-valid)", () => {
    const result = updateQuestionSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("F049: reorderQuestionsSchema", () => {
  it("accepts a list of id/position pairs", () => {
    const result = reorderQuestionsSchema.safeParse({
      questions: [
        { id: "11111111-1111-4111-8111-111111111111", position: 1 },
        { id: "22222222-2222-4222-8222-222222222222", position: 2 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty questions list", () => {
    const result = reorderQuestionsSchema.safeParse({ questions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    const result = reorderQuestionsSchema.safeParse({
      questions: [{ id: "not-a-uuid", position: 1 }],
    });
    expect(result.success).toBe(false);
  });
});
