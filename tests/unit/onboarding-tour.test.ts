import { describe, expect, it, vi, beforeEach } from "vitest";

// Chainable query-builder mock covering exactly the calls
// lib/actions/onboarding-tour.ts makes against `profiles`:
//   .from("profiles").select().eq().maybeSingle()   (getTourStatus)
//   .from("profiles").update().eq()                 (dismissTour/replayTour)
function makeSupabaseMock(opts: {
  user: { id: string } | null;
  tourCompletedAt: string | null;
  updateError?: { message: string } | null;
}) {
  const updateCalls: Array<{ tour_completed_at: string | null }> = [];

  const selectChain = {
    select: () => selectChain,
    eq: () => selectChain,
    maybeSingle: async () => ({
      data: opts.user ? { tour_completed_at: opts.tourCompletedAt } : null,
      error: null,
    }),
  };

  const updateChain = {
    eq: async () => ({
      error: opts.updateError ?? null,
    }),
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => selectChain,
        update: (patch: { tour_completed_at: string | null }) => {
          updateCalls.push(patch);
          return updateChain;
        },
      };
    },
    __updateCalls: updateCalls,
  };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

describe("onboarding tour actions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("AS-491: getTourStatus reports NOT dismissed for a first-time user (tour_completed_at is NULL), so the tour is offered", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "user-1" },
      tourCompletedAt: null,
    });

    const { getTourStatus } = await import("@/lib/actions/onboarding-tour");
    const result = await getTourStatus();

    expect(result).toEqual({ ok: true, dismissed: false });
  });

  it("AS-492: dismissTour persists a non-null timestamp on the caller's own profile row, so it reads back as dismissed", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "user-1" },
      tourCompletedAt: null,
    });

    const { dismissTour } = await import("@/lib/actions/onboarding-tour");
    const result = await dismissTour();

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.__updateCalls).toHaveLength(1);
    expect(mockSupabase.__updateCalls[0].tour_completed_at).toEqual(
      expect.any(String),
    );
  });

  it("AS-492: getTourStatus reports dismissed once tour_completed_at is set, and this holds across a fresh read (simulating reload / new tab)", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "user-1" },
      tourCompletedAt: "2026-08-20T00:00:00.000Z",
    });

    const { getTourStatus } = await import("@/lib/actions/onboarding-tour");

    // Two independent reads, as a reload and a new tab would each trigger
    // their own fresh call -- both must observe the same persisted state.
    const first = await getTourStatus();
    const second = await getTourStatus();

    expect(first).toEqual({ ok: true, dismissed: true });
    expect(second).toEqual({ ok: true, dismissed: true });
  });

  it("AS-493: replayTour resets tour_completed_at back to NULL so the tour is offered again", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "user-1" },
      tourCompletedAt: "2026-08-20T00:00:00.000Z",
    });

    const { replayTour } = await import("@/lib/actions/onboarding-tour");
    const result = await replayTour();

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.__updateCalls).toEqual([{ tour_completed_at: null }]);
  });

  it("negative: getTourStatus rejects an unauthenticated caller", async () => {
    mockSupabase = makeSupabaseMock({ user: null, tourCompletedAt: null });

    const { getTourStatus } = await import("@/lib/actions/onboarding-tour");
    const result = await getTourStatus();

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in.",
    });
  });

  it("negative: dismissTour rejects an unauthenticated caller and writes nothing", async () => {
    mockSupabase = makeSupabaseMock({ user: null, tourCompletedAt: null });

    const { dismissTour } = await import("@/lib/actions/onboarding-tour");
    const result = await dismissTour();

    expect(result.ok).toBe(false);
    expect(mockSupabase.__updateCalls).toHaveLength(0);
  });

  it("negative: a write failure surfaces a generic user-facing error, not the raw DB error", async () => {
    mockSupabase = makeSupabaseMock({
      user: { id: "user-1" },
      tourCompletedAt: null,
      updateError: { message: "permission denied for table profiles" },
    });

    const { dismissTour } = await import("@/lib/actions/onboarding-tour");
    const result = await dismissTour();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/permission denied/i);
    }
  });
});
