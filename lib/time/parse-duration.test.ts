import { describe, expect, it } from "vitest";

import { parseDurationToMinutes } from "@/lib/time/parse-duration";

describe("parseDurationToMinutes (global Track Time widget)", () => {
  it("test_track_time_parses_hours_and_minutes_combined", () => {
    expect(parseDurationToMinutes("3h 20m")).toBe(200);
  });

  it("test_track_time_parses_hours_and_minutes_with_no_space", () => {
    expect(parseDurationToMinutes("3h20m")).toBe(200);
  });

  it("test_track_time_parses_hours_only", () => {
    expect(parseDurationToMinutes("2h")).toBe(120);
  });

  it("test_track_time_parses_minutes_only", () => {
    expect(parseDurationToMinutes("45m")).toBe(45);
  });

  it("test_track_time_parses_clock_shape", () => {
    expect(parseDurationToMinutes("1:30")).toBe(90);
  });

  it("test_track_time_parses_bare_number_as_minutes", () => {
    expect(parseDurationToMinutes("90")).toBe(90);
  });

  it("test_track_time_returns_null_for_empty_input", () => {
    expect(parseDurationToMinutes("")).toBeNull();
    expect(parseDurationToMinutes("   ")).toBeNull();
  });

  it("test_track_time_returns_null_for_unparseable_input", () => {
    expect(parseDurationToMinutes("not a duration")).toBeNull();
  });

  it("test_track_time_returns_null_for_zero_duration", () => {
    expect(parseDurationToMinutes("0h 0m")).toBeNull();
    expect(parseDurationToMinutes("0")).toBeNull();
  });
});
