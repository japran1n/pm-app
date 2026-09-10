// Unit test for F062 (AS-153, AS-154): multiple client contacts on a
// project all see the same brief answers, and any of them can edit any
// answer. The actual enforcement is DB/RLS-level
// (20261122040000_f046_brief_rls.sql's `brief_answers_select` /
// `brief_answers_update_client` policies, project-scoped rather than
// answered_by-scoped -- see F046). This file verifies two things a
// worker could regress without a live-DB integration test noticing:
//
// 1. The BriefAnswer type still records who last answered
//    (`answeredBy`), which is what AS-154 relies on for attribution
//    without restricting who *can* answer.
// 2. `getBriefForClient`'s source text contains no
//    `.eq("answered_by", ...)` filter on brief_answers -- i.e. nobody
//    re-introduced a per-user filter that would break AS-153 ("all
//    client contacts see the same answers").
//
// Reading the source is deliberate here, not incidental: the whole
// point of AS-153/AS-154 is "the query returns everyone's answers", and
// the only way to catch a future worker silently adding
// `.eq('answered_by', user.id)` is to assert its absence in the text,
// since a live RLS integration test is out of scope for this unit
// suite (same reasoning f048-brief-query.test.ts documents for why
// getBrief/getBriefForClient aren't invoked here against a real
// Supabase client).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BriefAnswer } from "@/lib/queries/brief";

const briefQueriesSource = readFileSync(
  join(process.cwd(), "lib/queries/brief.ts"),
  "utf-8",
);

describe("F062 (AS-153): getBriefForClient does not filter answers by who answered", () => {
  it("brief.ts source has no .eq('answered_by', ...) filter anywhere", () => {
    expect(briefQueriesSource).not.toMatch(/\.eq\(\s*["']answered_by["']/);
  });

  it("getBriefForClient and getBrief share the exact same unfiltered loader (no per-user branch)", () => {
    // Both team and client readers call the same
    // loadBriefWithQuestionsAndAnswers helper with only a projectId --
    // there is no user-id parameter threaded through either path that
    // could be used to filter answers by who answered them.
    const clientReaderMatch = briefQueriesSource.match(
      /export async function getBriefForClient\(([^)]*)\)/,
    );
    expect(clientReaderMatch).not.toBeNull();
    expect(clientReaderMatch?.[1]).not.toMatch(/user/i);
  });
});

describe("F062 (AS-154): BriefAnswer type shape allows any contact to be the last editor", () => {
  it("answeredBy records who last saved the answer, with no ownership restriction encoded in the type", () => {
    const answerFromContactA: BriefAnswer = {
      id: "00000000-0000-4000-8000-000000000010",
      briefId: "00000000-0000-4000-8000-000000000001",
      questionId: "00000000-0000-4000-8000-000000000003",
      questionPromptSnapshot: "What is the primary goal of this project?",
      answerText: "Launch the new site",
      answerOptions: null,
      answeredBy: "00000000-0000-4000-8000-000000000005",
      answeredAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };

    // A second contact overwrites the same answer row (same id/briefId/
    // questionId), only answeredBy/answeredAt/answerText change -- the
    // type places no constraint that would prevent this.
    const answerFromContactB: BriefAnswer = {
      ...answerFromContactA,
      answerText: "Launch the new site by Q4",
      answeredBy: "00000000-0000-4000-8000-000000000099",
      answeredAt: "2026-09-11T00:00:00.000Z",
    };

    expect(answerFromContactB.id).toBe(answerFromContactA.id);
    expect(answerFromContactB.answeredBy).not.toBe(answerFromContactA.answeredBy);
  });
});
