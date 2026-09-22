import { describe, expect, it } from "vitest";

import { inboxBadgeCount } from "@/lib/inbox/inbox-badge-count";

// F014: SB-053 (the Inbox nav item shows an aggregate badge = unread
// notifications + pending approvals + open requests), SB-054 (the badge
// is hidden when the sum is 0), SB-055 (a failed source contributes 0
// rather than breaking the badge/nav item).
describe("inboxBadgeCount (F014: SB-053, SB-054, SB-055)", () => {
  it("test_SB_053_sums_unread_notifications_pending_approvals_and_open_requests", () => {
    expect(
      inboxBadgeCount({
        unreadNotifications: 3,
        pendingApprovals: 2,
        openRequests: 1,
      }),
    ).toBe(6);
  });

  it("test_SB_053_sums_correctly_when_only_one_source_is_nonzero", () => {
    expect(
      inboxBadgeCount({ unreadNotifications: 5, pendingApprovals: 0, openRequests: 0 }),
    ).toBe(5);
    expect(
      inboxBadgeCount({ unreadNotifications: 0, pendingApprovals: 4, openRequests: 0 }),
    ).toBe(4);
    expect(
      inboxBadgeCount({ unreadNotifications: 0, pendingApprovals: 0, openRequests: 7 }),
    ).toBe(7);
  });

  it("test_SB_054_returns_zero_hidden_state_when_every_source_is_zero", () => {
    expect(
      inboxBadgeCount({ unreadNotifications: 0, pendingApprovals: 0, openRequests: 0 }),
    ).toBe(0);
  });

  it("test_SB_055_a_failed_source_reported_as_zero_does_not_break_the_sum", () => {
    // A failed source fails open to 0 at the query layer (see each
    // source's own doc comment) before it ever reaches this helper -- the
    // sum still reflects the other two sources correctly.
    expect(
      inboxBadgeCount({ unreadNotifications: 0, pendingApprovals: 3, openRequests: 2 }),
    ).toBe(5);
  });

  it("test_SB_055_clamps_negative_or_non_finite_input_to_zero_contribution", () => {
    expect(
      inboxBadgeCount({ unreadNotifications: -5, pendingApprovals: NaN, openRequests: 2 }),
    ).toBe(2);
  });
});
