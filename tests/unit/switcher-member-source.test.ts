// Unit coverage for F014 (AS-030): the people switcher's member source.
//
// getWorkspaceMembers (lib/queries/members.ts) already splits active vs.
// pending workspace_members rows (F017/AS-023, see
// tests/integration/workspace-members-list.test.ts). This feature reuses
// that function rather than adding a new query — per this feature's own
// spec note ("getWorkspaceMembers already splits active from pending;
// reuse rather than add a query"). This test proves the specific
// behaviour the switcher depends on: a member whose `workspace_members`
// row has been removed, or whose status is no longer "active" (e.g.
// deactivated/pending), is excluded from `result.active` and therefore
// never appears in the switcher's source list.
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
const ACTIVE_USER_ID = "22222222-2222-4222-8222-222222222222";
const REMOVED_USER_ID = "33333333-3333-4333-8333-333333333333";
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

  it("excludes a member who has been deactivated/removed (status no longer active)", async () => {
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
        id: "member-row-removed",
        user_id: REMOVED_USER_ID,
        role: "member",
        status: "removed",
        invited_email: null,
        created_at: "2026-01-02T00:00:00Z",
        status_note: null,
        status_note_until: null,
        workspace_id: WORKSPACE_ID,
      },
    ];

    const result = await getWorkspaceMembers(WORKSPACE_ID);

    expect(result.active).toHaveLength(1);
    expect(result.active.some((m) => m.userId === REMOVED_USER_ID)).toBe(false);
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
