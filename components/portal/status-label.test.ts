// F004 (missions/20260903-portal): `resolveClientBucket` is the single
// place a project status's `category` (three values) and optional
// `client_bucket` override combine into one of the four client-facing
// buckets `StatusPill` tints by (AS-015). These tests exercise the
// derivation itself, independent of any component, per this feature's
// own "no second mapping that can diverge" requirement -- if this
// function's answer ever changes, every consumer (StatusPill, and any
// future team-side surface) changes with it.
import { describe, expect, it } from "vitest";

import { clientStatusLabel, resolveClientBucket } from "@/components/portal/status-label";

describe("resolveClientBucket", () => {
  // F006g (missions/20260903-portal, AS-017): `not_started` used to fall
  // back to "waiting" -- a Backlog page nobody had touched yet was
  // reported to the client as blocked on THEM. It now groups with
  // in-progress work instead; only an explicit override or
  // `pendingClientApproval` can put a row in "waiting".
  it("test_AS_017_not_started_category_falls_back_to_progress_not_waiting_with_no_override", () => {
    expect(resolveClientBucket("not_started", null)).toBe("progress");
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

  // F006g (missions/20260903-portal, AS-015, AS-017): `pendingClientApproval`
  // is the per-task signal (`tasks.pending_client_approval`) this feature
  // folds in so the Overview's "Waiting on you" list and the Pages
  // distribution's "Waiting on you" count agree by construction -- both
  // now resolve "is this row waiting" through this one function.
  it("test_AS_017_pending_client_approval_wins_over_a_progress_bucket_status", () => {
    expect(resolveClientBucket("in_progress", null, true)).toBe("waiting");
  });

  it("test_AS_017_pending_client_approval_wins_over_an_explicit_blocked_override", () => {
    expect(resolveClientBucket("in_progress", "blocked", true)).toBe("waiting");
  });

  it("test_AS_017_pending_client_approval_is_ignored_on_a_done_status", () => {
    // A delivered task is never "waiting" -- the same "done" exclusion
    // the Overview's original `pending_client_approval` check always
    // applied.
    expect(resolveClientBucket("done", null, true)).toBe("done");
  });

  it("test_AS_017_pending_client_approval_false_has_no_effect", () => {
    expect(resolveClientBucket("not_started", null, false)).toBe("progress");
  });
});

// F006g (missions/20260903-portal, AS-015): `clientStatusLabel` used to
// resolve its "waiting" case with a `/review/i` regex against the raw
// status name -- in this module, F004's own designated single home for
// "how does a status read to a client" -- using exactly the name-matching
// approach F004 was forbidden to use. These tests are this feature's own
// failure test: a status named "Design review" with no `client_bucket`
// must NOT be classified as waiting by its name.
describe("clientStatusLabel", () => {
  it("test_AS_015_a_status_named_review_with_no_override_is_not_classified_as_waiting_by_its_name", () => {
    expect(clientStatusLabel("in_progress", null)).not.toBe("Waiting on your review");
    expect(clientStatusLabel("in_progress", null)).toBe("In progress");
  });

  it("test_AS_015_a_status_named_review_still_reads_as_waiting_when_explicitly_bucketed_that_way", () => {
    // The correct way to reach "Waiting on your review" -- an explicit
    // override, not the word "review" in the name.
    expect(clientStatusLabel("in_progress", "waiting")).toBe("Waiting on your review");
  });

  it("test_AS_015_not_started_with_no_override_reads_as_in_progress_not_planned_or_waiting", () => {
    expect(clientStatusLabel("not_started", null)).toBe("In progress");
  });

  it("test_AS_015_done_category_reads_as_delivered", () => {
    expect(clientStatusLabel("done", null)).toBe("Delivered");
  });

  it("test_AS_015_explicit_blocked_override_reads_as_blocked", () => {
    expect(clientStatusLabel("in_progress", "blocked")).toBe("Blocked");
  });
});
