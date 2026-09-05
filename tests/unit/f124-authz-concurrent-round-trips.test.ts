// F124 (AS-081 through AS-085): lib/actions/authz.ts's withAuthz used to
// run four fully sequential network round trips (getUser -> resolveWorkspace
// -> requireActiveMembership -> isProjectVisibleToCaller) before an
// action's own handler started. This feature made steps 1 (getUser) and 2
// (resolveWorkspace) run concurrently (they are provably independent —
// resolveWorkspace never reads `user`) and wrapped the createClient() +
// getUser() pair in React's cache() so a request that resolves identity
// through more than one call site only pays the network round trip once.
//
// These tests exercise `withAuthz` directly (not a specific action module)
// so they derive from the assertion text, not from tasks.ts/phases.ts's
// own call sites.
//
// AS-085 (the actual before/after latency numbers) is not a unit-testable
// claim -- see this feature's handoff for the real measurements taken
// against the running dev server.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getUserMock: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getSessionMock: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createClientMock: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let requireActiveMembershipMock: any;

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __admin: true }),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: (...args: unknown[]) =>
    requireActiveMembershipMock(...args),
}));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.resetModules();
  getUserMock = vi.fn(async () => ({ data: { user: { id: USER_ID } } }));
  getSessionMock = vi.fn(async () => ({
    data: { session: { user: { id: USER_ID } } },
  }));
  createClientMock = vi.fn(async () => ({
    auth: { getUser: getUserMock, getSession: getSessionMock },
  }));
  requireActiveMembershipMock = vi.fn(async () => ({
    ok: true,
    role: "member",
  }));
});

async function loadWithAuthz() {
  const mod = await import("@/lib/actions/authz");
  return mod.withAuthz;
}

const schema = z.object({ workspaceId: z.string() });

describe("withAuthz (F124)", () => {
  it("test_AS_084_uses_getUser_never_getSession", async () => {
    const withAuthz = await loadWithAuthz();
    const action = withAuthz(
      schema,
      {
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    await action({ workspaceId: WORKSPACE_ID });

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("test_AS_081_getUser_and_resolveWorkspace_run_concurrently_not_sequentially", async () => {
    const withAuthz = await loadWithAuthz();

    // Both legs take ~60ms. If they ran sequentially (the pre-F124
    // behavior), the wrapped call would take >=120ms. Running them
    // concurrently keeps it close to a single 60ms leg.
    createClientMock.mockImplementation(async () => {
      await sleep(60);
      return { auth: { getUser: getUserMock, getSession: getSessionMock } };
    });

    let resolveWorkspaceCalledAt = -1;
    let getUserCalledAt = -1;
    const start = Date.now();
    getUserMock.mockImplementation(async () => {
      getUserCalledAt = Date.now() - start;
      return { data: { user: { id: USER_ID } } };
    });

    const action = withAuthz(
      schema,
      {
        resolveWorkspace: async () => {
          resolveWorkspaceCalledAt = Date.now() - start;
          await sleep(60);
          return { ok: true, workspaceId: WORKSPACE_ID, extra: {} };
        },
      },
      async () => ({ ok: true }) as { ok: true },
    );

    await action({ workspaceId: WORKSPACE_ID });
    const elapsed = Date.now() - start;

    // resolveWorkspace started immediately, not after waiting for
    // createClient()+getUser() to finish first.
    expect(resolveWorkspaceCalledAt).toBeLessThan(30);
    // getUser() itself runs right after createClient()'s own ~60ms leg
    // resolves (it's called ON that client), well before the ~120ms mark
    // a sequential "wait for getUser, THEN start resolveWorkspace's own
    // 60ms" implementation would produce.
    expect(getUserCalledAt).toBeLessThan(90);
    // Total wall time reflects the two ~60ms legs overlapping, not
    // stacking to >=120ms.
    expect(elapsed).toBeLessThan(100);
  });

  it("test_AS_082_signed_out_caller_is_refused_even_when_workspace_also_fails_to_resolve", async () => {
    // Precedence when BOTH legs fail (F124's own deliberate choice,
    // matching pre-F124 behavior where resolveWorkspace was never even
    // reached until after the signed-in check passed): the caller sees
    // "not signed in", not the workspace's own not-found error.
    const withAuthz = await loadWithAuthz();
    getUserMock.mockResolvedValue({ data: { user: null } });

    const action = withAuthz(
      schema,
      {
        notSignedInError: "You must be signed in.",
        resolveWorkspace: async () => ({
          ok: false,
          error: "Workspace not found.",
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({ ok: false, error: "You must be signed in." });
  });

  it("test_AS_082_signed_out_caller_is_refused_with_the_same_message_when_workspace_resolves_fine", async () => {
    const withAuthz = await loadWithAuthz();
    getUserMock.mockResolvedValue({ data: { user: null } });

    const action = withAuthz(
      schema,
      {
        notSignedInError: "You must be signed in.",
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({ ok: false, error: "You must be signed in." });
  });

  it("test_AS_082_signed_in_caller_still_refused_when_workspace_resolution_fails", async () => {
    const withAuthz = await loadWithAuthz();

    const action = withAuthz(
      schema,
      {
        resolveWorkspace: async () => ({
          ok: false,
          error: "Workspace not found.",
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({ ok: false, error: "Workspace not found." });
  });

  it("test_AS_082_signed_in_caller_without_active_membership_is_refused", async () => {
    const withAuthz = await loadWithAuthz();
    requireActiveMembershipMock.mockResolvedValue({ ok: false });

    const action = withAuthz(
      schema,
      {
        membershipError: "You don't have permission to do this.",
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do this.",
    });
  });

  it("test_AS_082_viewer_role_still_refused_write_when_requireWrite_is_set", async () => {
    const withAuthz = await loadWithAuthz();
    requireActiveMembershipMock.mockResolvedValue({ ok: true, role: "viewer" });

    const action = withAuthz(
      schema,
      {
        requireWrite: true,
        writeError: "Viewers don't have permission to do this.",
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({
      ok: false,
      error: "Viewers don't have permission to do this.",
    });
  });

  it("test_AS_082_member_role_still_allowed_write_when_requireWrite_is_set", async () => {
    const withAuthz = await loadWithAuthz();
    requireActiveMembershipMock.mockResolvedValue({ ok: true, role: "member" });

    const action = withAuthz(
      schema,
      {
        requireWrite: true,
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    const result = await action({ workspaceId: WORKSPACE_ID });
    expect(result).toEqual({ ok: true });
  });

  it("test_AS_083_a_second_call_site_in_the_same_request_reuses_the_first_getUser_call", async () => {
    // Simulates a request-scoped dispatcher being active (what Next.js's
    // real react-server runtime provides during an actual request/action
    // invocation, and what this plain Vitest environment does NOT provide
    // -- see this feature's handoff for how the real per-request scoping
    // was verified against the actual running app instead). With a real
    // memoizing cache() active, two withAuthz-wrapped calls in the same
    // "request" must not each pay their own getUser() round trip.
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      const registry = new Map<unknown, unknown>();
      return {
        ...actual,
        cache: (fn: (...args: unknown[]) => unknown) => {
          return (...args: unknown[]) => {
            if (!registry.has(fn)) {
              registry.set(fn, fn(...args));
            }
            return registry.get(fn);
          };
        },
      };
    });

    const withAuthz = await loadWithAuthz();

    const actionA = withAuthz(
      schema,
      {
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );
    const actionB = withAuthz(
      schema,
      {
        resolveWorkspace: async () => ({
          ok: true,
          workspaceId: WORKSPACE_ID,
          extra: {},
        }),
      },
      async () => ({ ok: true }) as { ok: true },
    );

    await actionA({ workspaceId: WORKSPACE_ID });
    await actionB({ workspaceId: WORKSPACE_ID });

    // Both calls resolved the SAME cached identity; createClient() (and
    // therefore getUser()) only actually ran once.
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledTimes(1);

    vi.doUnmock("react");
  });
});
