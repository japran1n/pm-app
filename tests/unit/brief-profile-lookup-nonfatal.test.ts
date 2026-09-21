import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, { data: unknown; error: { message: string } | null }> = {};

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const result = () => tables[table];
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.order = () => Promise.resolve(result());
      chain.maybeSingle = () => Promise.resolve(result());
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return chain;
    },
  }),
}));

import { getBriefWithRevisions } from "@/lib/queries/brief";

beforeEach(() => {
  tables.brief_answers = {
    data: {
      id: "a1",
      brief_id: "b1",
      question_id: "q1",
      question_prompt_snapshot: "Q",
      answer_text: "A",
      answer_options: null,
      answered_by: "u1",
      answered_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
    error: null,
  };
  tables.brief_answer_revisions = {
    data: [
      {
        id: "r1",
        answer_id: "a1",
        previous_text: "old",
        previous_options: null,
        changed_by: "u2",
        changed_at: "2026-09-02T00:00:00Z",
      },
    ],
    error: null,
  };
});

describe("BR-017: profile-name lookup is non-fatal in getBriefWithRevisions", () => {
  it("test_BR_017_profile_error_still_returns_ok_with_null_names", async () => {
    tables.profiles = { data: null, error: { message: "boom" } };
    const result = await getBriefWithRevisions("b1", "q1");
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.answeredByName).toBeNull();
      expect(result.data.revisions).toHaveLength(1);
      expect(result.data.revisions[0].changedByName).toBeNull();
    }
  });

  it("test_BR_017_profile_success_resolves_names", async () => {
    tables.profiles = {
      data: [
        { id: "u1", display_name: "Ana" },
        { id: "u2", display_name: "Bo" },
      ],
      error: null,
    };
    const result = await getBriefWithRevisions("b1", "q1");
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.answeredByName).toBe("Ana");
      expect(result.data.revisions[0].changedByName).toBe("Bo");
    }
  });
});
