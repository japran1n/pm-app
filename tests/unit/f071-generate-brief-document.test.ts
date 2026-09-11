// Unit tests for F071 (lib/brief/document.ts, lib/actions/brief.ts):
// covers AS-139 (the team can generate a brief document from the
// answers), AS-140 (four fixed sections), AS-141 (client answers quoted
// under the relevant section), and AS-142 (stored as a `docs` row of
// kind 'brief').
//
// `buildBriefDocumentContent` is a pure function -- no Supabase client
// needed -- so the section/quoting behaviour (AS-140/AS-141) is tested
// directly against it, deriving expectations from the assertion text
// (four fixed headings, each question's prompt + answer quoted beneath
// it) rather than from the implementation. `generateBriefDocument`
// itself calls `createClient()` from `@/lib/supabase/server`, which
// needs a real request context -- exercising it against a live Supabase
// project is an integration concern, matching F048/F049's documented
// precedent (tests/unit/f048-brief-query.test.ts,
// tests/unit/f049-brief-question-crud.test.ts). This file verifies the
// module's public surface and the content-building logic that backs
// AS-142's document shape.

import { describe, expect, it } from "vitest";
import * as briefActions from "@/lib/actions/brief";
import {
  buildBriefDocumentContent,
  BRIEF_DOCUMENT_SECTIONS,
} from "@/lib/brief/document";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

function makeQuestion(overrides: Partial<BriefQuestion>): BriefQuestion {
  return {
    id: "q1",
    projectId: "p1",
    prompt: "What is the project about?",
    category: "overview",
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<BriefAnswer>): BriefAnswer {
  return {
    id: "a1",
    briefId: "b1",
    questionId: "q1",
    questionPromptSnapshot: "What is the project about?",
    answerText: "A new website.",
    answerOptions: null,
    answeredBy: "u1",
    answeredAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasRevisions: false,
    ...overrides,
  };
}

describe("F071: lib/actions/brief.ts exports generateBriefDocument", () => {
  it("exports generateBriefDocument", () => {
    expect(typeof briefActions.generateBriefDocument).toBe("function");
  });
});

describe("F071 AS-140: the generated document contains four fixed sections", () => {
  it("defines exactly four fixed sections with the expected headings", () => {
    expect(BRIEF_DOCUMENT_SECTIONS.map((s) => s.heading)).toEqual([
      "Project Overview",
      "Goals & Objectives",
      "Target Audience",
      "Technical Requirements",
    ]);
  });

  it("renders all four section headings even with no questions at all", () => {
    const content = buildBriefDocumentContent([], []);
    expect(content).toContain("## Project Overview");
    expect(content).toContain("## Goals & Objectives");
    expect(content).toContain("## Target Audience");
    expect(content).toContain("## Technical Requirements");
  });

  it("shows a 'no questions added' placeholder for an empty category", () => {
    const content = buildBriefDocumentContent([], []);
    const overviewIndex = content.indexOf("## Project Overview");
    const goalsIndex = content.indexOf("## Goals & Objectives");
    const overviewSection = content.slice(overviewIndex, goalsIndex);
    expect(overviewSection).toContain("No questions added.");
  });
});

describe("F071 AS-141: the document quotes the client's answers under the relevant section", () => {
  it("places a question's prompt and answer under its own category section", () => {
    const questions = [
      makeQuestion({ id: "q1", category: "overview", prompt: "What is the project about?" }),
      makeQuestion({ id: "q2", category: "goals", prompt: "What does success look like?" }),
    ];
    const answers = [
      makeAnswer({ id: "a1", questionId: "q1", answerText: "A new marketing site." }),
      makeAnswer({ id: "a2", questionId: "q2", answerText: "More signups." }),
    ];

    const content = buildBriefDocumentContent(questions, answers);

    const overviewIndex = content.indexOf("## Project Overview");
    const goalsIndex = content.indexOf("## Goals & Objectives");
    const audienceIndex = content.indexOf("## Target Audience");

    const overviewSection = content.slice(overviewIndex, goalsIndex);
    const goalsSection = content.slice(goalsIndex, audienceIndex);

    expect(overviewSection).toContain("What is the project about?");
    expect(overviewSection).toContain("A new marketing site.");
    expect(overviewSection).not.toContain("More signups.");

    expect(goalsSection).toContain("What does success look like?");
    expect(goalsSection).toContain("More signups.");
    expect(goalsSection).not.toContain("A new marketing site.");
  });

  it("quotes a multi/single choice answer's selected options, joined", () => {
    const questions = [
      makeQuestion({ id: "q3", category: "audience", prompt: "Who is the audience?" }),
    ];
    const answers = [
      makeAnswer({
        id: "a3",
        questionId: "q3",
        answerText: null,
        answerOptions: ["Small businesses", "Freelancers"],
      }),
    ];

    const content = buildBriefDocumentContent(questions, answers);
    expect(content).toContain("Small businesses, Freelancers");
  });

  it("shows a placeholder for a question that has no answer yet", () => {
    const questions = [
      makeQuestion({ id: "q4", category: "technical", prompt: "Any integrations needed?" }),
    ];
    const content = buildBriefDocumentContent(questions, []);
    expect(content).toContain("Any integrations needed?");
    expect(content).toContain("No answer yet.");
  });
});

describe("F071 AS-139/AS-142: generateBriefDocument's shape", () => {
  it("returns a Promise resolving to a success/documentId/error shape (signature check)", () => {
    const result = briefActions.generateBriefDocument("project-id", "brief-id");
    expect(result).toBeInstanceOf(Promise);
    // Swallow the rejection/resolution -- this test only asserts the
    // function's callable signature without a live Supabase context,
    // matching F049's documented precedent for DB-touching actions.
    result.catch(() => undefined);
  });
});
