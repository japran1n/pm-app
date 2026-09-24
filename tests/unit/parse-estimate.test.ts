// Unit test for F166 (AS-298, AS-299): the "human duration string" ->
// minutes parser (lib/time/parse-estimate.ts), tested in isolation from any
// component or Server Action per this feature's Clarified implementation.

import { describe, expect, it } from "vitest";

import { parseEstimate } from "@/lib/time/parse-estimate";

describe("parseEstimate", () => {
  it("test_AS_298_parses_hours_only", () => {
    expect(parseEstimate("2h")).toBe(120);
  });

  it("test_AS_298_parses_minutes_only", () => {
    expect(parseEstimate("90m")).toBe(90);
  });

  it("test_AS_298_parses_hours_and_minutes_with_space", () => {
    expect(parseEstimate("1h 30m")).toBe(90);
  });

  it("test_AS_298_parses_hours_and_minutes_without_space", () => {
    expect(parseEstimate("1h30m")).toBe(90);
  });

  it("test_AS_298_parses_bare_integer_as_minutes", () => {
    expect(parseEstimate("45")).toBe(45);
  });

  it("test_AS_298_is_case_insensitive_and_trims_whitespace", () => {
    expect(parseEstimate("  2H  ")).toBe(120);
  });

  it("test_AS_299_rejects_zero_minutes", () => {
    expect(parseEstimate("0m")).toBeNull();
    expect(parseEstimate("0")).toBeNull();
    expect(parseEstimate("0h")).toBeNull();
    expect(parseEstimate("0h 0m")).toBeNull();
  });

  it("test_AS_299_rejects_negative_input", () => {
    expect(parseEstimate("-5m")).toBeNull();
    expect(parseEstimate("-1h")).toBeNull();
  });

  it("test_AS_299_rejects_unparseable_garbage", () => {
    expect(parseEstimate("abc")).toBeNull();
    expect(parseEstimate("2x")).toBeNull();
    expect(parseEstimate("1h 1h")).toBeNull();
    expect(parseEstimate("h")).toBeNull();
    expect(parseEstimate("m")).toBeNull();
  });

  // REUSE-LOGIC-10: estimates share the app's single duration parser, which
  // accepts fractional hours and rounds to whole minutes (the stored
  // integer column is unchanged).
  it("test_AS_298_fractional_hours_round_to_whole_minutes", () => {
    expect(parseEstimate("1.5h")).toBe(90);
  });

  it("test_AS_298_rejects_empty_or_whitespace_only_input", () => {
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("   ")).toBeNull();
  });
});
