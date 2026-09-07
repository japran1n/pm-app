// Client Presentation advance-notice banner: pure "today"/"tomorrow"
// window-detection logic, tested independently of any Supabase call (see
// lib/calendar/client-presentation.ts's own file-header comment for why
// this is a page-load-triggered check, not a real scheduled job).

import { describe, expect, it } from "vitest";

import {
  classifyPresentationTrigger,
  getPresentationWindow,
  getUpcomingClientPresentations,
} from "@/lib/calendar/client-presentation";

const NOW = "2026-09-10T12:00:00.000Z"; // a Thursday, mid-day UTC

describe("Client Presentation window detection", () => {
  it("test_classifies_a_block_starting_later_today_as_the_today_trigger", () => {
    expect(classifyPresentationTrigger("2026-09-10T18:00:00.000Z", NOW)).toBe("today");
  });

  it("test_classifies_a_block_starting_earlier_today_as_the_today_trigger", () => {
    // Already happened earlier today -- still "today", not filtered out;
    // the banner still shows it was today's presentation.
    expect(classifyPresentationTrigger("2026-09-10T02:00:00.000Z", NOW)).toBe("today");
  });

  it("test_classifies_a_block_starting_tomorrow_as_the_tomorrow_trigger", () => {
    expect(classifyPresentationTrigger("2026-09-11T09:00:00.000Z", NOW)).toBe("tomorrow");
  });

  it("test_a_block_two_days_out_is_outside_the_window_and_returns_null", () => {
    expect(classifyPresentationTrigger("2026-09-12T09:00:00.000Z", NOW)).toBeNull();
  });

  it("test_a_block_that_already_happened_yesterday_is_outside_the_window_and_returns_null", () => {
    expect(classifyPresentationTrigger("2026-09-09T09:00:00.000Z", NOW)).toBeNull();
  });

  it("test_the_boundary_between_today_and_tomorrow_is_exactly_midnight_utc", () => {
    expect(classifyPresentationTrigger("2026-09-10T23:59:59.000Z", NOW)).toBe("today");
    expect(classifyPresentationTrigger("2026-09-11T00:00:00.000Z", NOW)).toBe("tomorrow");
  });

  it("test_get_presentation_window_derives_all_three_boundaries_from_one_now", () => {
    const window = getPresentationWindow(NOW);
    expect(window.todayStart.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(window.tomorrowStart.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(window.dayAfterTomorrowStart.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });
});

// Fake Supabase client -- just enough of the query builder chain
// getUpcomingClientPresentations calls, so this test only exercises
// this module's own filtering/mapping logic, not a real database.
function fakeSupabase(rows: Array<Record<string, unknown>>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: async () => ({ data: rows, error: null }),
  };
  return { from: () => builder } as never;
}

describe("getUpcomingClientPresentations", () => {
  it("test_maps_rows_to_upcoming_presentations_with_the_correct_trigger_and_project_name", async () => {
    const supabase = fakeSupabase([
      {
        id: "block-1",
        title: "Client Presentation",
        starts_at: "2026-09-10T18:00:00.000Z",
        project_id: "proj-1",
        block_type: "client_presentation",
        projects: { name: "Acme Redesign" },
      },
    ]);

    const result = await getUpcomingClientPresentations(supabase, "workspace-1", NOW);

    expect(result).toEqual([
      {
        id: "block-1",
        title: "Client Presentation",
        startsAt: "2026-09-10T18:00:00.000Z",
        projectId: "proj-1",
        projectName: "Acme Redesign",
        trigger: "today",
      },
    ]);
  });

  it("test_returns_an_empty_list_when_the_query_errors_rather_than_throwing", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                lt: () => ({
                  order: async () => ({ data: null, error: new Error("boom") }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never;

    const result = await getUpcomingClientPresentations(supabase, "workspace-1", NOW);
    expect(result).toEqual([]);
  });

  it("test_does_not_duplicate_a_presentation_across_repeated_calls_for_the_same_now", async () => {
    // Simulates a member reloading the page multiple times in the same
    // day: since the banner is recomputed fresh from the same source
    // rows every call (never appended to a stored list), calling this
    // twice with identical inputs yields identical, non-duplicated output.
    const rows = [
      {
        id: "block-1",
        title: "Client Presentation",
        starts_at: "2026-09-10T18:00:00.000Z",
        project_id: null,
        block_type: "client_presentation",
        projects: null,
      },
    ];

    const first = await getUpcomingClientPresentations(fakeSupabase(rows), "workspace-1", NOW);
    const second = await getUpcomingClientPresentations(fakeSupabase(rows), "workspace-1", NOW);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first).toEqual(second);
  });
});
