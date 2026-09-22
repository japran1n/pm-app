// F055 (FU-M4-8, SB-054): de-duplicate the Inbox badge sum. A notification
// kind that mirrors an already-counted queue item (client_request_submitted,
// approval_owner_nudge, approval_decided) must not also add +1 to
// getNotificationsForWorkspace's `unreadCount`, or the same underlying
// entity is counted twice across the Inbox badge's three summed sources
// (lib/inbox/inbox-badge-count.ts).
//
// These tests build the REAL minimal Supabase query-builder shape
// getNotificationsForWorkspace actually issues (same stub-builder
// convention as tests/unit/f015-client-requests-count-query.test.ts) and
// assert on the function's real resolved `unreadCount` -- never a
// mockRejectedValue substitute, since this function never rejects.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { getNotificationsForWorkspace } from "@/lib/queries/notifications";
import { MIRRORED_QUEUE_NOTIFICATION_KINDS } from "@/lib/notifications/fanout";
import { inboxBadgeCount } from "@/lib/inbox/inbox-badge-count";

type NotifRow = { id: string; task_id: string | null; kind: string };

function buildSupabase(mainRows: NotifRow[], unreadRows: NotifRow[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal thenable query-builder stub
  const notificationsTable: any = {
    select: vi.fn((cols: string) => {
      // The unread lookup selects "id, task_id, kind" with no `.limit`
      // chained after `.is`; the main list selects a wider column set and
      // is chained with `.order().limit()`.
      const isUnreadShape = cols === "id, task_id, kind";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal thenable query-builder stub
      const builder: any = {
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve({ data: mainRows, error: null })),
        is: vi.fn(() =>
          isUnreadShape
            ? Promise.resolve({ data: unreadRows, error: null })
            : Promise.resolve({ data: [], error: null }),
        ),
      };
      return builder;
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal thenable query-builder stub
  const tasksTable: any = {
    select: vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  };
  const fromMock = vi.fn((table: string) => {
    if (table === "notifications") return notificationsTable;
    if (table === "tasks") return tasksTable;
    throw new Error(`unexpected table ${table}`);
  });
  return { from: fromMock };
}

describe("F055 (FU-M4-8, SB-054): de-duplicated Inbox badge sum", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("test_SB_054_mirrored_notification_kinds_are_declared_and_stable", () => {
    expect(MIRRORED_QUEUE_NOTIFICATION_KINDS).toEqual(
      expect.arrayContaining([
        "client_request_submitted",
        "approval_owner_nudge",
        "approval_decided",
      ]),
    );
    expect(MIRRORED_QUEUE_NOTIFICATION_KINDS.length).toBe(3);
  });

  it("test_SB_054_one_pending_client_request_plus_its_fanout_notification_counts_once_not_twice", async () => {
    // Seed: one unread `client_request_submitted` notification -- the
    // fan-out for a pending client request the "openRequests" source
    // already counts as 1 (simulated directly below, since that count
    // comes from a different query function entirely).
    const supabase = buildSupabase(
      [],
      [{ id: "n1", task_id: null, kind: "client_request_submitted" }],
    );
    vi.mocked(getCurrentUser).mockResolvedValue({
      supabase: supabase as never,
      user: { id: "u1" } as never,
    });

    const { unreadCount } = await getNotificationsForWorkspace("ws-1");

    // Without the fix this would be 1 (double-counted alongside
    // openRequests' own 1); with the fix it must be 0.
    expect(unreadCount).toBe(0);

    const total = inboxBadgeCount({
      unreadNotifications: unreadCount,
      pendingApprovals: 0,
      openRequests: 1, // the pending client request, counted by its own source
    });
    expect(total).toBe(1);
  });

  it("test_SB_054_approval_owner_nudge_and_approval_decided_are_excluded_from_unread_count", async () => {
    const supabase = buildSupabase(
      [],
      [
        { id: "n1", task_id: null, kind: "approval_owner_nudge" },
        { id: "n2", task_id: null, kind: "approval_decided" },
        { id: "n3", task_id: null, kind: "mention" },
      ],
    );
    vi.mocked(getCurrentUser).mockResolvedValue({
      supabase: supabase as never,
      user: { id: "u1" } as never,
    });

    const { unreadCount } = await getNotificationsForWorkspace("ws-1");

    // Only the non-mirrored "mention" row counts.
    expect(unreadCount).toBe(1);
  });

  it("test_SB_054_non_mirrored_kinds_still_count_normally", async () => {
    const supabase = buildSupabase(
      [],
      [
        { id: "n1", task_id: null, kind: "task_assigned" },
        { id: "n2", task_id: null, kind: "watcher_update" },
      ],
    );
    vi.mocked(getCurrentUser).mockResolvedValue({
      supabase: supabase as never,
      user: { id: "u1" } as never,
    });

    const { unreadCount } = await getNotificationsForWorkspace("ws-1");

    expect(unreadCount).toBe(2);
  });
});
