// Unit tests for F147 (AS-262): lib/tasks/task-key.ts's parseTaskKeyQuery,
// the single pure, side-effect-free parser that turns a free-typed search
// query into a candidate (projectKey, taskNumber) pair. Per this feature's
// explicit instruction, this is the ONLY place the key-search regex may
// appear — the command palette (F242) is expected to import this same
// function rather than re-implementing the pattern.
//
// These tests exercise the parser in isolation (no DB, no Supabase client)
// per the assigned "unit for pure logic" definition-of-done answer. The
// DB-backed exact-match lookup itself (including the cross-workspace
// isolation guarantee) is covered separately in
// tests/integration/search-task-key.test.ts.

import { describe, expect, it } from "vitest";

import { parseTaskKeyQuery } from "@/lib/tasks/task-key";

describe("parseTaskKeyQuery (F147, AS-262)", () => {
  it("test_AS_262_parses_the_canonical_dashed_form", () => {
    expect(parseTaskKeyQuery("PM-142")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
  });

  it("test_AS_262_is_case_insensitive", () => {
    expect(parseTaskKeyQuery("pm-142")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
    expect(parseTaskKeyQuery("Pm-142")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
  });

  it("test_AS_262_tolerates_the_dash_being_absent", () => {
    expect(parseTaskKeyQuery("pm142")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
  });

  it("test_AS_262_tolerates_a_space_instead_of_a_dash", () => {
    expect(parseTaskKeyQuery("pm 142")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
  });

  it("test_AS_262_trims_surrounding_whitespace_before_parsing", () => {
    expect(parseTaskKeyQuery("  PM-142  ")).toEqual({
      projectKey: "PM",
      taskNumber: 142,
    });
  });

  it("test_AS_262_works_for_longer_project_keys_and_multi_digit_numbers", () => {
    expect(parseTaskKeyQuery("ENGINE-9081")).toEqual({
      projectKey: "ENGINE",
      taskNumber: 9081,
    });
  });

  it("test_AS_262_negative_plain_prose_that_is_not_a_key_pattern_returns_null", () => {
    expect(parseTaskKeyQuery("fix the login bug")).toBeNull();
    expect(parseTaskKeyQuery("urgent")).toBeNull();
    expect(parseTaskKeyQuery("142")).toBeNull();
  });

  it("test_AS_262_negative_a_zero_or_negative_number_never_parses", () => {
    // Not a realistic key (tasks_number_positive rejects <= 0 at the DB
    // layer), but this parser is the first line of defense against ever
    // treating "PM-0" as a candidate to look up.
    expect(parseTaskKeyQuery("PM-0")).toBeNull();
  });

  it("test_AS_262_negative_empty_or_blank_query_returns_null", () => {
    expect(parseTaskKeyQuery("")).toBeNull();
    expect(parseTaskKeyQuery("   ")).toBeNull();
  });

  it("test_AS_262_negative_a_prefix_longer_than_the_max_key_length_does_not_parse", () => {
    // projects.key is capped at 6 characters by F145's projects_key_format
    // CHECK (^[A-Z][A-Z0-9]{1,5}$) — a 7+ letter prefix can never be a real
    // key, so this parser doesn't treat it as a key-shaped query.
    expect(parseTaskKeyQuery("TOOLONGKEY142")).toBeNull();
  });
});
