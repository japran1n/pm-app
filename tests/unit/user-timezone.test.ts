// F124 (AS-207): unit tests for lib/time/user-timezone.ts — "due-date and
// overdue calculations use the user's timezone, not the server's."
// Verifies the module independently of React/Supabase, per the clarified
// spec's "unit-tested independently of React and Supabase" pattern.
//
// Every offset/DST fact used below was verified directly against Node's
// own `Intl` before being encoded as an expectation (not assumed from
// memory) — see this feature's handoff for the verification commands.
// August 2026: Pacific/Auckland is in NZST (UTC+12, southern-hemisphere
// winter, no DST active); America/Los_Angeles is in PDT (UTC-7).
// America/New_York's 2026 spring-forward transition is 2026-03-08T07:00Z
// (2:00am EST -> 3:00am EDT).

import { describe, expect, it } from "vitest";

import {
  endOfDayInTimeZone,
  isOverdueInTimeZone,
  isTodayInTimeZone,
  isValidTimeZone,
  startOfDayInTimeZone,
  todayInTimeZone,
} from "@/lib/time/user-timezone";

describe("AS-207: overdue/today calculations use the caller's timezone, not the server's", () => {
  it("test_AS_207_user_east_of_utc_sees_task_overdue_before_a_utc_user_does", () => {
    // 2026-08-18T22:00:00Z: still "2026-08-18" in UTC, but already
    // "2026-08-19" in Auckland (UTC+12) — so a task due 2026-08-18 has
    // already rolled past due for the Auckland user while a UTC user
    // still sees it as due *today*, not yet overdue. This is the "task
    // due 'today' for one user is already 'yesterday' for another"
    // scenario the feature exists to fix.
    const instant = new Date("2026-08-18T22:00:00Z");
    const dueDate = "2026-08-18";

    expect(isOverdueInTimeZone(dueDate, "todo", "UTC", instant)).toBe(false);
    expect(
      isOverdueInTimeZone(dueDate, "todo", "Pacific/Auckland", instant),
    ).toBe(true);

    expect(todayInTimeZone("UTC", instant)).toBe("2026-08-18");
    expect(todayInTimeZone("Pacific/Auckland", instant)).toBe("2026-08-19");
  });

  it("test_AS_207_user_west_of_utc_does_not_yet_see_task_overdue_when_utc_already_does", () => {
    // 2026-08-19T02:00:00Z: already "2026-08-19" in UTC (so a task due
    // 2026-08-18 is overdue by UTC's own clock), but still
    // "2026-08-18" in Los Angeles (UTC-7) — the LA user still sees the
    // task as due *today*, not overdue yet. Same task, same instant,
    // opposite verdicts depending on whose timezone is used — exactly
    // what AS-207 requires the app to get right everywhere.
    const instant = new Date("2026-08-19T02:00:00Z");
    const dueDate = "2026-08-18";

    expect(isOverdueInTimeZone(dueDate, "todo", "UTC", instant)).toBe(true);
    expect(
      isOverdueInTimeZone(dueDate, "todo", "America/Los_Angeles", instant),
    ).toBe(false);

    expect(todayInTimeZone("UTC", instant)).toBe("2026-08-19");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe(
      "2026-08-18",
    );
  });

  it("test_AS_207_done_status_is_never_overdue_regardless_of_timezone", () => {
    const instant = new Date("2026-08-19T02:00:00Z");
    expect(
      isOverdueInTimeZone("2026-08-18", "done", "UTC", instant),
    ).toBe(false);
    expect(
      isOverdueInTimeZone(
        "2026-08-18",
        "done",
        "Pacific/Auckland",
        instant,
      ),
    ).toBe(false);
  });

  it("test_AS_207_null_due_date_is_never_overdue_in_any_timezone", () => {
    const instant = new Date("2026-08-19T02:00:00Z");
    expect(isOverdueInTimeZone(null, "todo", "UTC", instant)).toBe(false);
    expect(
      isOverdueInTimeZone(null, "todo", "Pacific/Auckland", instant),
    ).toBe(false);
  });

  it("test_AS_207_dst_spring_forward_boundary_america_new_york", () => {
    // America/New_York springs forward at 2026-03-08T07:00:00Z (2am EST
    // -> 3am EDT). A task due 2026-03-08 must still roll over to overdue
    // at exactly local midnight the following night, not 24 raw hours
    // after local midnight began (which would be an hour early because
    // the transition day is only 23 real hours long).
    const dueDate = "2026-03-08";

    // 2026-03-09T03:30:00Z = 2026-03-08T23:30 EDT (-4h, transition
    // already happened earlier that day) — still "today" in New York,
    // not yet overdue.
    expect(
      isOverdueInTimeZone(
        dueDate,
        "todo",
        "America/New_York",
        new Date("2026-03-09T03:30:00Z"),
      ),
    ).toBe(false);

    // 2026-03-09T04:30:00Z = 2026-03-09T00:30 EDT — New York has rolled
    // over to the next calendar day, so the task is now overdue.
    expect(
      isOverdueInTimeZone(
        dueDate,
        "todo",
        "America/New_York",
        new Date("2026-03-09T04:30:00Z"),
      ),
    ).toBe(true);
  });

  it("test_AS_207_start_and_end_of_day_resolve_the_dst_aware_utc_boundary", () => {
    // Local midnight on the spring-forward day itself is still standard
    // time (EST, UTC-5) — the 2am->3am jump hasn't happened yet.
    expect(startOfDayInTimeZone("2026-03-08", "America/New_York")).toEqual(
      new Date("2026-03-08T05:00:00.000Z"),
    );
    // The day's own end (23:59:59.999 local) falls after the jump, so
    // it's EDT (UTC-4) by then — NOT a fixed 24h after start-of-day.
    expect(endOfDayInTimeZone("2026-03-08", "America/New_York")).toEqual(
      new Date("2026-03-09T03:59:59.999Z"),
    );
    // The transition day is therefore only 23 real hours long, not 24.
    const start = startOfDayInTimeZone(
      "2026-03-08",
      "America/New_York",
    )!;
    const end = endOfDayInTimeZone("2026-03-08", "America/New_York")!;
    const durationMs = end.getTime() - start.getTime() + 1;
    expect(durationMs).toBe(23 * 60 * 60 * 1000);
  });

  it("test_AS_207_start_and_end_of_day_for_an_ordinary_non_dst_day", () => {
    // Pacific/Auckland, no DST active in August — a plain fixed +12h day.
    expect(startOfDayInTimeZone("2026-08-18", "Pacific/Auckland")).toEqual(
      new Date("2026-08-17T12:00:00.000Z"),
    );
    expect(endOfDayInTimeZone("2026-08-18", "Pacific/Auckland")).toEqual(
      new Date("2026-08-18T11:59:59.999Z"),
    );
  });

  it("test_AS_207_is_today_agrees_with_is_overdue_at_the_boundary", () => {
    const instant = new Date("2026-08-18T22:00:00Z");
    // Due "today" (in Auckland's own zone) is never overdue.
    expect(isTodayInTimeZone("2026-08-19", "Pacific/Auckland", instant)).toBe(
      true,
    );
    expect(
      isOverdueInTimeZone("2026-08-19", "todo", "Pacific/Auckland", instant),
    ).toBe(false);
  });

  it("test_AS_207_invalid_timezone_returns_false_or_null_never_throws", () => {
    expect(() =>
      isOverdueInTimeZone("2026-08-18", "todo", "Not/A_Real_Zone"),
    ).not.toThrow();
    expect(isOverdueInTimeZone("2026-08-18", "todo", "Not/A_Real_Zone")).toBe(
      false,
    );
    expect(todayInTimeZone("Not/A_Real_Zone")).toBeNull();
    expect(startOfDayInTimeZone("2026-08-18", "Not/A_Real_Zone")).toBeNull();
    expect(endOfDayInTimeZone("2026-08-18", "Not/A_Real_Zone")).toBeNull();
    expect(isTodayInTimeZone("2026-08-18", "Not/A_Real_Zone")).toBe(false);
    expect(isValidTimeZone("Not/A_Real_Zone")).toBe(false);
  });

  it("test_AS_207_uppercase_utc_and_malformed_date_strings_are_handled_safely", () => {
    // F123's own discovery: "UTC" (not just "Etc/UTC") must be accepted —
    // it's F120's DB default and every unset profile's actual value.
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(
      isOverdueInTimeZone("2026-08-18", "todo", "UTC", new Date("2026-08-19T00:00:00Z")),
    ).toBe(true);

    expect(isOverdueInTimeZone("not-a-date", "todo", "UTC")).toBe(false);
    expect(startOfDayInTimeZone("not-a-date", "UTC")).toBeNull();
    expect(endOfDayInTimeZone("not-a-date", "UTC")).toBeNull();
    expect(isTodayInTimeZone("not-a-date", "UTC")).toBe(false);
  });
});
