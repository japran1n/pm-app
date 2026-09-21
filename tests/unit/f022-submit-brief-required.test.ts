import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  questions: [] as { id: string; answer_type: string }[],
  answers: [] as { question_id: string; answer_text: string | null; answer_options: string[] | null }[],
  update: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    user: { id: "u1" },
    supabase: {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const result = () => {
          if (table === "briefs") return { data: { id: "b1", state: "draft", project_id: "p1" }, error: null };
          if (table === "brief_questions") return { data: state.questions, error: null };
          return { data: state.answers, error: null };
        };
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => result();
        chain.update = (v: unknown) => {
          state.update(v);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        };
        chain.then = (r: (v: unknown) => unknown) => Promise.resolve(result()).then(r);
        return chain;
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notifications/create-notification", () => ({ createNotification: vi.fn() }));

import { submitBrief } from "@/lib/actions/brief";

beforeEach(() => {
  state.update.mockReset();
  state.questions = [{ id: "q1", answer_type: "short_text" }];
  state.answers = [];
});

describe("F022 submitBrief server-side required check", () => {
  it("BR-015/BR-044/BR-047: missing required answer => success:false, no state update", async () => {
    const r = await submitBrief("b1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/i);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("BR-015: whitespace-only required text still blocks", async () => {
    state.answers = [{ question_id: "q1", answer_text: "   ", answer_options: null }];
    expect((await submitBrief("b1")).success).toBe(false);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("BR-016: single_choice with 2 legacy options counts as answered; submit proceeds", async () => {
    state.questions = [{ id: "q1", answer_type: "single_choice" }];
    state.answers = [{ question_id: "q1", answer_text: null, answer_options: ["a", "b"] }];
    const r = await submitBrief("b1");
    expect(r.success).toBe(true);
    expect(state.update).toHaveBeenCalledWith({ state: "submitted" });
  });
  it("BR-044: all required answered => proceeds", async () => {
    state.answers = [{ question_id: "q1", answer_text: "hi", answer_options: null }];
    expect((await submitBrief("b1")).success).toBe(true);
    expect(state.update).toHaveBeenCalled();
  });
});
