// Unit test for the AS-007 follow-up (F099): proves inviteMember's
// already-active-member duplicate check finds a match regardless of how
// many auth users exist or where the match sits in listUsers' pages.
//
// Fully mocks @/lib/supabase/server and @/lib/supabase/admin so this runs
// with no real Supabase project/creds — unlike tests/integration/
// invite-member.test.ts (which is skipped without SUPABASE creds), this
// test always runs. It simulates a >50-user instance by having the fake
// admin client's listUsers() cap every page at 50 users regardless of the
// `perPage` value the caller passes, forcing the implementation's
// pagination loop to actually traverse multiple pages to find a match.

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "owner-user-id";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "target-active-member-id";
const TARGET_EMAIL = "already-active-member@example.com";

// Total simulated auth users and where the match sits, configurable per
// test so we can prove correctness both mid-list and on the very last page.
let totalUsers = 0;
let matchIndex = -1; // -1 = no match anywhere in the list
const REAL_PAGE_CAP = 50; // mirrors Supabase's actual per-page cap

function makeFakeUser(index: number) {
  if (index === matchIndex) {
    return { id: TARGET_USER_ID, email: TARGET_EMAIL };
  }
  return { id: `filler-user-${index}`, email: `filler-${index}@example.com` };
}

let listUsersCallCount = 0;
let listUsersRequestedPerPages: number[] = [];

const adminFromMock = vi.fn((table: string) => {
  if (table !== "workspace_members") {
    throw new Error(`Unexpected table in test mock: ${table}`);
  }

  const filters: Record<string, unknown> = {};
  let selectedColumns = "";

  const builder = {
    select(columns: string) {
      selectedColumns = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async maybeSingle() {
      // 1) requireWorkspaceAdmin's active-membership check for the caller.
      if (
        selectedColumns === "role" &&
        filters.workspace_id === WORKSPACE_ID &&
        filters.user_id === OWNER_ID &&
        filters.status === "active"
      ) {
        return { data: { role: "owner" }, error: null };
      }

      // 2) existing-invite-by-email check — no pre-existing invite row in
      // this scenario.
      if (
        selectedColumns === "id, status" &&
        "invited_email" in filters
      ) {
        return { data: null, error: null };
      }

      // 3) existing-membership-by-user-id check, run only after the
      // (possibly paginated) auth-user lookup resolves a matching user.
      if (
        selectedColumns === "id, status" &&
        filters.workspace_id === WORKSPACE_ID &&
        filters.user_id === TARGET_USER_ID
      ) {
        return { data: { id: "membership-row-id", status: "active" }, error: null };
      }

      return { data: null, error: null };
    },
  };

  return builder;
});

const fakeAdminClient = {
  from: adminFromMock,
  auth: {
    admin: {
      listUsers: vi.fn(async (params?: { page?: number; perPage?: number }) => {
        listUsersCallCount += 1;
        const requestedPerPage = params?.perPage ?? 50;
        listUsersRequestedPerPages.push(requestedPerPage);
        const page = params?.page ?? 1;

        // Simulate the real Supabase Admin API: it caps each page at 50
        // users no matter what perPage the caller asks for isn't strictly
        // real behavior (Supabase does honor perPage), but capping here is
        // exactly what exercises the bug this test guards against — if the
        // implementation ever regresses to a single unpaginated call (or
        // stops following `nextPage`), a match past page 1 will never be
        // found.
        const start = (page - 1) * REAL_PAGE_CAP;
        const end = Math.min(start + REAL_PAGE_CAP, totalUsers);
        const users =
          start >= totalUsers
            ? []
            : Array.from({ length: end - start }, (_, i) => makeFakeUser(start + i));

        const lastPage = Math.max(1, Math.ceil(totalUsers / REAL_PAGE_CAP));
        const nextPage = page < lastPage ? page + 1 : null;

        return {
          data: { users, aud: "authenticated", nextPage, lastPage, total: totalUsers },
          error: null,
        };
      }),
    },
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: OWNER_ID } } }),
    },
  }),
}));

describe("inviteMember pagination (F099: AS-007)", () => {
  beforeEach(() => {
    listUsersCallCount = 0;
    listUsersRequestedPerPages = [];
    adminFromMock.mockClear();
    matchIndex = -1;
    totalUsers = 0;
  });

  it("AS-007: catches an already-active member sitting past the first page (>50 users, match on page 3)", async () => {
    totalUsers = 130;
    matchIndex = 125; // lands on the 3rd 50-user page

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, TARGET_EMAIL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already a member/i);
    }

    // Proves the implementation actually paginated rather than only
    // looking at a single page.
    expect(listUsersCallCount).toBeGreaterThanOrEqual(3);
  });

  it("AS-007: catches an already-active member on the very last page of a large user list", async () => {
    totalUsers = 214;
    matchIndex = 213; // last user, last page

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, TARGET_EMAIL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already a member/i);
    }
  });

  it("AS-007: a >50-user instance with no matching active member allows the invite to proceed to insert", async () => {
    totalUsers = 87;
    matchIndex = -1; // no match anywhere

    // Mock the final insert step separately since this path reaches it.
    const insertMock = vi.fn(async () => ({ error: null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminFromMock as any).mockImplementation((table: string) => {
      if (table === "workspace_members") {
        const filters: Record<string, unknown> = {};
        let selectedColumns = "";
        const builder = {
          select(columns: string) {
            selectedColumns = columns;
            return builder;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          insert: insertMock,
          async maybeSingle() {
            if (
              selectedColumns === "role" &&
              filters.status === "active" &&
              filters.user_id === OWNER_ID
            ) {
              return { data: { role: "owner" }, error: null };
            }
            return { data: null, error: null };
          },
        };
        return builder;
      }
      if (table === "workspaces") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: { slug: "test-workspace" }, error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(
      WORKSPACE_ID,
      "brand-new-invitee@example.com",
    );

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });
});
