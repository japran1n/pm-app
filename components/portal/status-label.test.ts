// F004 (missions/20260903-portal): `resolveClientBucket` is the single
// place a project status's `category` (three values) and optional
// `client_bucket` override combine into one of the four client-facing
// buckets `StatusPill` tints by (AS-015). These tests exercise the
// derivation itself, independent of any component, per this feature's
// own "no second mapping that can diverge" requirement -- if this
// function's answer ever changes, every consumer (StatusPill, and any
// future team-side surface) changes with it.
import { describe, expect, it } from "vitest";

import { resolveClientBucket } from "@/components/portal/status-label";

describe("resolveClientBucket", () => {
  it("test_AS_015_not_started_category_falls_back_to_waiting_with_no_override", () => {
    expect(resolveClientBucket("not_started", null)).toBe("waiting");
  });

  it("test_AS_015_in_progress_category_falls_back_to_progress_with_no_override", () => {
    expect(resolveClientBucket("in_progress", null)).toBe("progress");
  });

  it("test_AS_015_done_category_falls_back_to_done_with_no_override", () => {
    expect(resolveClientBucket("done", null)).toBe("done");
  });

  it("test_AS_015_undefined_client_bucket_falls_back_the_same_way_as_null", () => {
    expect(resolveClientBucket("in_progress", undefined)).toBe("progress");
  });

  // The distinction category cannot carry: "Awaiting Client Feedback" is
  // category `in_progress` on the team's own board
  // (docs/team-app-for-portal-plan.md's status table) but must read as
  // "waiting on the client" to a client, not "in progress" -- only an
  // explicit override can produce that.
  it("test_AS_015_explicit_waiting_override_wins_over_an_in_progress_category", () => {
    expect(resolveClientBucket("in_progress", "waiting")).toBe("waiting");
  });

  // No `category` value can ever express "blocked" -- this is the other
  // half of why `client_bucket` exists at all, not just a convenience.
  it("test_AS_015_explicit_blocked_override_wins_over_any_category", () => {
    expect(resolveClientBucket("not_started", "blocked")).toBe("blocked");
    expect(resolveClientBucket("in_progress", "blocked")).toBe("blocked");
    expect(resolveClientBucket("done", "blocked")).toBe("blocked");
  });

  it("test_AS_015_an_unrecognised_client_bucket_string_is_ignored_and_falls_back_to_category", () => {
    // Defends against a bad/legacy DB value reaching the UI as a crash or
    // an unstyled fifth bucket -- falls back exactly like null would.
    expect(resolveClientBucket("done", "not-a-real-bucket")).toBe("done");
  });
});
