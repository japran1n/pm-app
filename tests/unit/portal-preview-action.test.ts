// F024 (missions/20260903-portal, AS-052, AS-053): server-side coverage
// for lib/actions/portal-preview.ts. Mirrors
// tests/unit/portal-approval-action.test.ts's mocked-client pattern.
// `mintImpersonationSession` is mocked directly — this file owns the
// authz gate + audit write + cookie scoping, not the Supabase Admin API
// round-trip itself (that mechanism is a thin, separately-owned wrapper,
// lib/auth/mint-impersonation-session.ts).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_MEMBER_ROW_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const TASK_ID = "77777777-7777-4777-8777-777777777777";

type Opts = {
  user: { id: string } | null;
  membershipRole: string | null; // caller's own role, null = not a member
  clientMemberRole: string | null; // target's role, null = not found
  clientEmail: string | null;
  mintResult: { accessToken: string; refreshToken: string } | null;
};

let opts: Opts;
let auditCalls: unknown[];
let cookieSets: { name: string; value: string; options: unknown }[];

// The admin client is called twice against workspace_members with the
// SAME chained shape (select().eq().eq().eq().maybeSingle()) — once for
// the caller (requireWorkspaceAdmin) and once for the target client.
// Rather than fight the shared-shape mock, give each call its own
// maybeSingle by tracking call order.
let membershipCallCount = 0;
function makeAdminClientOrdered() {
  return {
    from: (table: string) => {
      if (table === "workspace_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    membershipCallCount += 1;
                    if (membershipCallCount === 1) {
                      // requireWorkspaceAdmin's own lookup (via
                      // requireActiveMembership)
                      return opts.membershipRole
                        ? { data: { role: opts.membershipRole }, error: null }
                        : { data: null, error: null };
                    }
                    // the target client's own lookup
                    return opts.clientMemberRole
                      ? {
                          data: {
                            id: CLIENT_MEMBER_ROW_ID,
                            role: opts.clientMemberRole,
                            status: "active",
                          },
                          error: null,
                        }
                      : { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          if (id !== CLIENT_USER_ID) {
            return { data: { user: null }, error: { message: "not found" } };
          }
          return {
            data: {
              user: opts.clientEmail ? { email: opts.clientEmail } : null,
            },
            error: null,
          };
        },
      },
    },
  };
}

function makeRlsClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    rpc: async (name: string, args: unknown) => {
      auditCalls.push({ name, args });
      return { data: { id: "audit-row-1" }, error: null };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeRlsClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClientOrdered(),
}));

vi.mock("@/lib/auth/mint-impersonation-session", () => ({
  mintImpersonationSession: async () => opts.mintResult,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) => {
      cookieSets.push({ name, value, options });
    },
    get: () => undefined,
  }),
}));

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    workspaceSlug: "acme",
    clientUserId: CLIENT_USER_ID,
    ...overrides,
  };
}

function defaultOpts(): Opts {
  return {
    user: { id: OWNER_ID },
    membershipRole: "owner",
    clientMemberRole: "client",
    clientEmail: "client@example.com",
    mintResult: { accessToken: "at-1", refreshToken: "rt-1" },
  };
}

describe("startClientPreview / exitClientPreview (F024)", () => {
  beforeEach(() => {
    vi.resetModules();
    membershipCallCount = 0;
    auditCalls = [];
    cookieSets = [];
    opts = defaultOpts();
  });

  it("test_AS_052_owner_can_start_a_preview_and_is_handed_a_portal_redirect", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result).toEqual({ ok: true, redirectTo: "/portal/acme" });
  });

  it("test_AS_052_admin_can_start_a_preview", async () => {
    opts.membershipRole = "admin";
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(true);
  });

  it("test_AS_052_a_member_role_cannot_reach_the_preview_action", async () => {
    opts.membershipRole = "member";
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
    expect(auditCalls).toHaveLength(0);
    expect(cookieSets).toHaveLength(0);
  });

  it("test_AS_052_a_viewer_role_cannot_reach_the_preview_action", async () => {
    opts.membershipRole = "viewer";
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
  });

  it("test_AS_052_a_caller_with_no_membership_at_all_is_rejected", async () => {
    opts.membershipRole = null;
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
  });

  it("test_AS_052_signed_out_caller_is_rejected", async () => {
    opts.user = null;
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
    expect(auditCalls).toHaveLength(0);
  });

  it("test_AS_052_target_user_who_is_not_a_client_of_this_workspace_is_rejected", async () => {
    opts.clientMemberRole = "member";
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
    expect(auditCalls).toHaveLength(0);
  });

  it("test_AS_052_target_user_with_no_active_membership_row_is_rejected", async () => {
    opts.clientMemberRole = null;
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
  });

  it("test_AS_052_invalid_input_is_rejected_before_any_lookup", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview({
      workspaceId: "not-a-uuid",
      workspaceSlug: "acme",
      clientUserId: CLIENT_USER_ID,
    });
    expect(result.ok).toBe(false);
    expect(auditCalls).toHaveLength(0);
  });

  it("test_AS_053_a_successful_preview_writes_exactly_one_audit_row", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    await startClientPreview(validInput());
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0] as { name: string }).name).toBe(
      "write_audit_log_entry",
    );
  });

  it("test_AS_053_the_audit_row_names_the_actor_via_the_actors_own_session_and_the_client_previewed", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    await startClientPreview(validInput());
    const call = auditCalls[0] as {
      args: {
        p_workspace_id: string;
        p_action: string;
        p_target_id: string;
        p_metadata: { clientUserId: string; clientEmail: string };
      };
    };
    expect(call.args.p_workspace_id).toBe(WORKSPACE_ID);
    expect(call.args.p_action).toBe("portal.preview_started");
    expect(call.args.p_target_id).toBe(CLIENT_MEMBER_ROW_ID);
    expect(call.args.p_metadata.clientUserId).toBe(CLIENT_USER_ID);
    expect(call.args.p_metadata.clientEmail).toBe("client@example.com");
  });

  it("test_AS_053_a_denied_attempt_writes_no_audit_row", async () => {
    opts.membershipRole = "member";
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    await startClientPreview(validInput());
    expect(auditCalls).toHaveLength(0);
  });

  it("test_AS_053_an_audit_row_is_written_even_when_session_minting_fails_afterward", async () => {
    // AS-053 says every ENTRY is logged -- an entry that got far enough
    // to be a real attempt (passed authz, resolved a real client) should
    // still be logged even if the session mint step fails, so the audit
    // trail isn't silently incomplete for failed attempts.
    opts.mintResult = null;
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput());
    expect(result.ok).toBe(false);
    expect(auditCalls).toHaveLength(1);
  });

  it("test_AS_052_the_minted_session_tokens_are_stored_in_portal_scoped_cookies_only", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    await startClientPreview(validInput());
    expect(cookieSets).toHaveLength(3);
    for (const set of cookieSets) {
      expect((set.options as { path: string }).path).toBe("/portal");
    }
    const access = cookieSets.find(
      (c) => c.name === "portal_preview_access_token",
    );
    expect(access?.value).toBe("at-1");
  });

  it("test_AS_052_a_project_and_task_deep_link_produces_a_portal_task_redirect", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(
      validInput({ projectId: PROJECT_ID, taskId: TASK_ID }),
    );
    expect(result).toEqual({
      ok: true,
      redirectTo: `/portal/acme/p/${PROJECT_ID}/t/${TASK_ID}`,
    });
  });

  it("test_AS_052_a_project_only_deep_link_produces_a_portal_project_redirect", async () => {
    const { startClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await startClientPreview(validInput({ projectId: PROJECT_ID }));
    expect(result).toEqual({
      ok: true,
      redirectTo: `/portal/acme/p/${PROJECT_ID}`,
    });
  });

  it("test_AS_052_exit_preview_clears_all_three_preview_cookies_scoped_to_portal", async () => {
    const { exitClientPreview } = await import("@/lib/actions/portal-preview");
    const result = await exitClientPreview("acme");
    expect(result.redirectTo).toBe("/w/acme/preview-as-client");
    expect(cookieSets).toHaveLength(3);
    for (const set of cookieSets) {
      expect((set.options as { path: string; maxAge: number }).path).toBe(
        "/portal",
      );
      expect((set.options as { path: string; maxAge: number }).maxAge).toBe(0);
    }
  });
});
