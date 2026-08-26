// Unit test for AS-007's already-active-member duplicate check in
// inviteMember: an existing user must be found by email, and the invite
// refused, regardless of how many auth users the project has.
//
// Rewritten when findAuthUserByEmail stopped paginating. The previous
// version mocked `admin.auth.admin.listUsers` and asserted the loop made
// at least three page calls — it pinned the implementation rather than the
// behaviour, and that implementation was exactly what broke in production:
// with tens of thousands of auth users GoTrue answers the first page with
// a 500, so every invite failed (see the fix's commit message, and
// tests/integration/invite-member.test.ts, which failed 5 of 7 cases even
// when run serially).
//
// So this file now mocks `fetch` — the GoTrue admin endpoint the lookup
// calls directly — and asserts what actually matters:
//
//   1. an existing active member is caught and the invite refused;
//   2. a NEAR-MISS is not mistaken for a match. This is new risk the
//      filter approach introduces and the old paging code did not have:
//      `?filter=` is a substring match, so looking up "an@example.com"
//      also returns "ryan@example.com". Attaching an invite to the wrong
//      person is a worse failure than the slow scan ever was, which is
//      why the exact comparison is asserted here and not just reviewed;
//   3. no match proceeds to the insert;
//   4. a failed lookup refuses the invite rather than treating the error
//      as "no such user" and silently creating a duplicate invite.

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "owner-user-id";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "target-active-member-id";
const TARGET_EMAIL = "already-active-member@example.com";

// What the mocked GoTrue admin endpoint returns for the next lookup, and
// whether it fails outright.
let filterResponseUsers: Array<{ id: string; email: string }> = [];
let filterResponseOk = true;
let capturedRequestUrls: string[] = [];

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
      // requireWorkspaceAdmin's active-membership check for the caller.
      if (
        selectedColumns === "role" &&
        filters.workspace_id === WORKSPACE_ID &&
        filters.user_id === OWNER_ID &&
        filters.status === "active"
      ) {
        return { data: { role: "owner" }, error: null };
      }

      // Existing-invite-by-email check — none in these scenarios.
      if (selectedColumns === "id, status" && "invited_email" in filters) {
        return { data: null, error: null };
      }

      // Existing-membership-by-user-id, reached only once the auth lookup
      // has resolved a matching user.
      if (
        selectedColumns === "id, status" &&
        filters.workspace_id === WORKSPACE_ID &&
        filters.user_id === TARGET_USER_ID
      ) {
        return {
          data: { id: "membership-row-id", status: "active" },
          error: null,
        };
      }

      return { data: null, error: null };
    },
  };

  return builder;
});

const fakeAdminClient = { from: adminFromMock };

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

describe("inviteMember: finding an existing user by email (AS-007)", () => {
  beforeEach(() => {
    adminFromMock.mockClear();
    filterResponseUsers = [];
    filterResponseOk = true;
    capturedRequestUrls = [];

    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
    process.env.SUPABASE_SECRET_KEY ??= "test-secret-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedRequestUrls.push(String(url));
        if (!filterResponseOk) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: filterResponseUsers }),
        };
      }),
    );
  });

  it("AS-007: refuses the invite when the email belongs to an already-active member", async () => {
    filterResponseUsers = [{ id: TARGET_USER_ID, email: TARGET_EMAIL }];

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, TARGET_EMAIL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already a member/i);
    }

    // One filtered request, not a scan of every user.
    expect(capturedRequestUrls).toHaveLength(1);
    expect(capturedRequestUrls[0]).toContain("/auth/v1/admin/users?filter=");
    expect(capturedRequestUrls[0]).toContain(encodeURIComponent(TARGET_EMAIL));
  });

  it("AS-007: finds the exact match even when the substring filter also returns other addresses", async () => {
    // What GoTrue actually returns for filter=already-active-member@example.com
    // if other accounts contain that string.
    filterResponseUsers = [
      { id: "someone-else", email: `x-${TARGET_EMAIL}` },
      { id: TARGET_USER_ID, email: TARGET_EMAIL },
      { id: "another", email: `${TARGET_EMAIL}.uk` },
    ];

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, TARGET_EMAIL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already a member/i);
    }
  });

  it("AS-007: a near-miss is NOT treated as a match (substring filter must not attach an invite to the wrong account)", async () => {
    // Looking up "an@example.com"; the substring filter also returns
    // "ryan@example.com", which is a different person entirely.
    filterResponseUsers = [{ id: TARGET_USER_ID, email: "ryan@example.com" }];

    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "new-membership-row-id" },
          error: null,
        })),
      })),
    }));
    stubInsertPath(insertMock);

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, "an@example.com");

    // Treated as a brand-new invitee, because it is one.
    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("AS-007: no existing user means the invite proceeds to insert", async () => {
    filterResponseUsers = [];

    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "new-membership-row-id" },
          error: null,
        })),
      })),
    }));
    stubInsertPath(insertMock);

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(
      WORKSPACE_ID,
      "brand-new-invitee@example.com",
    );

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it("AS-007: a failed lookup refuses the invite rather than assuming no such user exists", async () => {
    filterResponseOk = false;

    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: "new-membership-row-id" },
          error: null,
        })),
      })),
    }));
    stubInsertPath(insertMock);

    const { inviteMember } = await import("@/lib/actions/workspaces");
    const result = await inviteMember(WORKSPACE_ID, TARGET_EMAIL);

    expect(result.ok).toBe(false);
    // The important half: a lookup that errored must not fall through to
    // creating an invite for someone who may already be a member.
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// Swaps the workspace_members mock for one that also supports the final
// insert chain (.insert(...).select("id").single()), used by the cases
// that reach it.
function stubInsertPath(insertMock: ReturnType<typeof vi.fn>) {
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
}
