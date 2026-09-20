// Unit coverage for F014 (AS-030): the people switcher's member source.
//
// getWorkspaceMembers (lib/queries/members.ts) already splits active vs.
// pending workspace_members rows (F017/AS-023, see
// tests/integration/workspace-members-list.test.ts). This feature reuses
// that function rather than adding a new query — per this feature's own
// spec note ("getWorkspaceMembers already splits active from pending;
// reuse rather than add a query"). This test proves the specific
// behaviour the switcher depends on.
//
// NOTE: the `workspace_members_status_check` DB constraint only allows
// `'invited'` and `'active'` — there is no "removed" status value in
// production; member removal is a row DELETE. So the exclusion cases
// below are schema-producible: an absent row (deleted member), and an
// `invited` row that has since been backfilled with a `user_id` (the
// real leak vector — an invited user who accepted must still be
// classified by `status`, not by presence of `user_id`, and must not
// leak into `result.active`).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, type Row, type RowFilter } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let memberRows: Row[];
let membersError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => {
            const filters: RowFilter[] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push((row: Row) => row[col] === val);
                return builder;
              }),
              order: vi.fn(async () => {
                if (membersError) return { data: null, error: membersError };
                return { data: applyFilters(memberRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async (ids: string[]) => {
    const map = new Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>();
    for (const id of ids) {
      map.set(id, {
        name: `Name for ${id}`,
        email: `${id}@example.com`,
        avatarUrl: `https://avatars.example.com/${id}.png`,
      });
    }
    return map;
  }),
}));

import { getWorkspaceMembers } from "@/lib/queries/members";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const ACTIVE_USER_ID = "22222222-2222-4222-8222-222222222222";
const BACKFILLED_INVITED_USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_WORKSPACE_USER_ID = "55555555-5555-4555-8555-555555555555";
const PENDING_USER_ID = null;

beforeEach(() => {
  membersError = null;
});

describe("getWorkspaceMembers — switcher member source (AS-030)", () => {
  it("returns only active members, with id/name/avatarUrl", async () => {
    memberRows = [
      {
        id: "member-row-active",
        user_id: ACTIVE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(1);
    expect(result.active[0]).toMatchObject({
      userId: ACTIVE_USER_ID,
      name: `Name for ${ACTIVE_USER_ID}`,
      avatarUrl: `https://avatars.example.com/${ACTIVE_USER_ID}.png`,
    });
  });

  it("excludes a removed member because their row is absent (removal is a DELETE, not a status update)", async () => {
    // The `workspace_members_status_check` constraint only allows
    // 'invited' | 'active' — there is no "removed" status in production.
    // Removal deletes the row, so the only schema-true fixture for "was
    // removed" is simply not including a row for that user.
    memberRows = [
      {
        id: "member-row-active",
        user_id: ACTIVE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(1);
    expect(result.active[0].userId).toBe(ACTIVE_USER_ID);
  });

  it("excludes an invited row even after user_id has been backfilled (accepted-but-still-invited leak vector)", async () => {
    // This is the mutation-killing case: `r.status !== "removed"` would
    // let this row through (its status is "invited", not "removed"),
    // but `r.status === "active"` correctly excludes it. A backfilled
    // user_id on an "invited" row must not be enough to classify it as
    // active.
    memberRows = [
      {
        id: "member-row-active",
        user_id: ACTIVE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
      {
        id: "member-row-invited-backfilled",
        user_id: BACKFILLED_INVITED_USER_ID,
        role: "member",
        status: "invited",
        invited_email: "backfilled@example.com",
        created_at: "2026-01-02T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(1);
    expect(
      result.active.some((m) => m.userId === BACKFILLED_INVITED_USER_ID),
    ).toBe(false);
  });

  it("excludes rows belonging to a different workspace (workspace_id filter)", async () => {
    memberRows = [
      {
        id: "member-row-active",
        user_id: ACTIVE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
      {
        id: "member-row-other-workspace",
        user_id: OTHER_WORKSPACE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: OTHER_WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(1);
    expect(
      result.active.some((m) => m.userId === OTHER_WORKSPACE_USER_ID),
    ).toBe(false);
  });

  it("includes the row id (not just userId/name/avatarUrl) on returned active members", async () => {
    memberRows = [
      {
        id: "member-row-active",
        user_id: ACTIVE_USER_ID,
        role: "member",
        status: "active",
        invited_email: null,
        created_at: "2026-01-01T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active[0]).toMatchObject({ id: "member-row-active" });
  });

  it("propagates an error when the workspace_members query fails", async () => {
    memberRows = [];
    membersError = { message: "connection reset" };

    await expect(getWorkspaceMembers(WORKSPACE_ID)).rejects.toEqual({
      message: "connection reset",
    });
  });

  it("excludes pending invites (no user_id yet) from the active list", async () => {
    memberRows = [
      {
        id: "member-row-pending",
        user_id: PENDING_USER_ID,
        role: "member",
        status: "invited",
        invited_email: "invitee@example.com",
        created_at: "2026-01-03T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
  });
});
