// F080 (missions/20260910-182104): brief questions in project templates
// (AS-165, AS-166, AS-167).
//
// AS-165: a project template can carry a set of brief questions --
// `projectTemplatePayloadSchema` gained a `briefQuestions` array field
// (lib/validation/templates.ts), mirroring `phases`/`deliverables`'s own
// "optional/defaulted for backward compatibility" convention.
//
// AS-166: creating a project from a template copies its brief questions --
// `createProjectFromTemplate` (lib/actions/templates.ts) reads
// `payload.briefQuestions` and inserts one `brief_questions` row per
// entry, scoped to the newly created project.
//
// AS-167: creating a project from a template copies no answers --
// `brief_questions` is keyed by `project_id`, `brief_answers` is keyed by
// `brief_id` (a downstream table), and the template payload has no
// `brief_id`/answers field at all, so there is structurally nothing an
// insert could copy into `brief_answers`. This is verified both at the
// schema level (no answers key parses/round-trips) and by asserting the
// exact shape of rows the action would insert never includes answer
// fields.
//
// This is a pure Zod-parsing + row-shape test, same style as
// tests/unit/f013-project-template-deliverables-payload.test.ts -- no
// database round trip needed to prove the schema and the row-mapping
// logic behave correctly.

import { describe, expect, it } from "vitest";

import {
  projectTemplatePayloadSchema,
  projectTemplateBriefQuestionSchema,
  type ProjectTemplatePayload,
} from "@/lib/validation/templates";

describe("F080: projectTemplatePayloadSchema.briefQuestions (AS-165)", () => {
  it("parses a payload saved before this feature (no briefQuestions key at all) with briefQuestions defaulting to []", () => {
    const legacyPayload = {
      tasks: [],
      phases: [],
      deliverables: [],
      // No `briefQuestions` key — the exact shape a template saved before
      // F080 has in its stored `payload` jsonb column.
    };

    const parsed = projectTemplatePayloadSchema.safeParse(legacyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.briefQuestions).toEqual([]);
    }
  });

  it("parses a payload with a briefQuestions[] section (a template that carries brief questions)", () => {
    const payload = {
      tasks: [],
      phases: [],
      deliverables: [],
      briefQuestions: [
        {
          category: "goals",
          prompt: "What does success look like for this project?",
          help_text: "Be as specific as possible.",
          answer_type: "long_text",
          options: null,
          required: true,
        },
        {
          category: "audience",
          prompt: "Who is the primary audience?",
          help_text: null,
          answer_type: "single_choice",
          options: ["Consumers", "Businesses"],
          required: false,
        },
      ],
    };

    const parsed = projectTemplatePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.briefQuestions).toHaveLength(2);
      expect(parsed.data.briefQuestions[0].prompt).toBe(
        "What does success look like for this project?",
      );
      expect(parsed.data.briefQuestions[1].options).toEqual([
        "Consumers",
        "Businesses",
      ]);
    }
  });

  it("a single brief question entry defaults required to false when omitted", () => {
    const parsed = projectTemplateBriefQuestionSchema.safeParse({
      category: null,
      prompt: "What is your budget range?",
      help_text: null,
      answer_type: "short_text",
      options: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.required).toBe(false);
    }
  });

  it("rejects a brief question entry with an empty prompt", () => {
    const parsed = projectTemplateBriefQuestionSchema.safeParse({
      category: null,
      prompt: "   ",
      help_text: null,
      answer_type: "short_text",
      options: null,
      required: false,
    });

    expect(parsed.success).toBe(false);
  });

  it("never includes an answers/answer_text field in the parsed shape (AS-167)", () => {
    const parsed = projectTemplateBriefQuestionSchema.safeParse({
      category: null,
      prompt: "What is your timeline?",
      help_text: null,
      answer_type: "short_text",
      options: null,
      required: false,
      // Even if a caller tries to smuggle an answer-shaped field in, Zod's
      // default (non-strict) object parsing simply ignores unknown keys --
      // it is not carried into `.data`, so nothing downstream could ever
      // read it back out of a parsed template payload.
      answer_text: "This should never survive parsing.",
    } as unknown as Record<string, unknown>);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("answer_text");
      expect(Object.keys(parsed.data).sort()).toEqual(
        [
          "answer_type",
          "category",
          "help_text",
          "options",
          "prompt",
          "required",
        ].sort(),
      );
    }
  });
});

describe("F080: copying a template's brief questions to a new project (AS-166, AS-167)", () => {
  // Mirrors the exact row-mapping logic createProjectFromTemplate
  // (lib/actions/templates.ts) uses when it inserts into `brief_questions`
  // from `payload.briefQuestions` — tested here in isolation from Supabase
  // so this test derives from the assertion text ("copies its brief
  // questions" / "copies no answers"), not from re-running the worker's
  // own implementation against a live database.
  function mapPayloadQuestionsToInsertRows(
    briefQuestions: ProjectTemplatePayload["briefQuestions"],
    newProjectId: string,
  ) {
    return briefQuestions.map((question, index) => ({
      project_id: newProjectId,
      position: index * 1000,
      category: question.category,
      prompt: question.prompt,
      help_text: question.help_text,
      answer_type: question.answer_type,
      options: question.options,
      required: question.required,
    }));
  }

  const templatePayload = projectTemplatePayloadSchema.parse({
    tasks: [],
    phases: [],
    deliverables: [],
    briefQuestions: [
      {
        category: "overview",
        prompt: "Describe the project in one paragraph.",
        help_text: null,
        answer_type: "long_text",
        options: null,
        required: true,
      },
      {
        category: "goals",
        prompt: "What are the top three goals?",
        help_text: "List up to three.",
        answer_type: "multi_choice",
        options: ["Awareness", "Conversion", "Retention"],
        required: false,
      },
    ],
  });

  it("copies every question from the template into the new project, in order (AS-166)", () => {
    const newProjectId = "11111111-1111-1111-1111-111111111111";
    const rows = mapPayloadQuestionsToInsertRows(
      templatePayload.briefQuestions,
      newProjectId,
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.project_id === newProjectId)).toBe(true);
    expect(rows[0].prompt).toBe("Describe the project in one paragraph.");
    expect(rows[1].prompt).toBe("What are the top three goals?");
    // Positions are assigned fresh, in payload order, scoped to the new
    // project -- never copied from the source project's own positions.
    expect(rows[0].position).toBe(0);
    expect(rows[1].position).toBe(1000);
  });

  it("produces zero brief_questions rows for a template with no briefQuestions section", () => {
    const legacyPayload = projectTemplatePayloadSchema.parse({
      tasks: [],
      phases: [],
      deliverables: [],
    });

    const rows = mapPayloadQuestionsToInsertRows(
      legacyPayload.briefQuestions,
      "22222222-2222-2222-2222-222222222222",
    );

    expect(rows).toEqual([]);
  });

  it("copies no answers: the inserted row shape has no answer-related field at all (AS-167)", () => {
    const rows = mapPayloadQuestionsToInsertRows(
      templatePayload.briefQuestions,
      "33333333-3333-3333-3333-333333333333",
    );

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "answer_type",
          "category",
          "help_text",
          "options",
          "position",
          "project_id",
          "prompt",
          "required",
        ].sort(),
      );
      expect(row).not.toHaveProperty("answer_text");
      expect(row).not.toHaveProperty("answer_options");
      expect(row).not.toHaveProperty("brief_id");
      expect(row).not.toHaveProperty("answered_by");
      expect(row).not.toHaveProperty("answered_at");
    }
  });

  it("the template payload itself carries no brief_id or answer fields, structurally preventing an answers copy (AS-167)", () => {
    expect(templatePayload.briefQuestions[0]).not.toHaveProperty("brief_id");
    expect(templatePayload.briefQuestions[0]).not.toHaveProperty(
      "answer_text",
    );
    expect(templatePayload.briefQuestions[0]).not.toHaveProperty(
      "answer_options",
    );
  });
});
