import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SEC audit 2026-09-24 (MEDIUM auth-flow fixes): invites need an explicit,
// email-bound accept; sign-in never auto-accepts; the magic-link response
// never depends on whether the account exists; post-auth redirects only
// accept same-origin paths; boolean env flags parse explicitly.
//
// Pure mock-based — no network, no database.

// ---------------------------------------------------------------------------
// Chainable Supabase query mock that records every call.
// ---------------------------------------------------------------------------

type Call = { table: string; op: string; args: unknown[] };

function makeAdminMock(results: Record<string, unknown>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const record = (op: string) =>
      (...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      };
    for (const op of ["select", "eq", "is", "in", "limit", "order", "update", "delete", "insert"]) {
      chain[op] = record(op);
    }
    const settle = (op: string) => async () => {
      calls.push({ table, op, args: [] });
      const key = `${table}.${calls.filter((c) => c.table === table && (c.op === "update" || c.op === "delete")).length ? "write" : "read"}`;
      return results[key] ?? { data: null, error: null };
    };
    chain.maybeSingle = settle("maybeSingle");
    chain.single = settle("single");
    // Awaiting the chain itself (list queries / delete().select()).
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      settle("await")().then(resolve, reject);
    return chain;
  };
  return {
    calls,
    client: { from, rpc: vi.fn(async () => ({ error: null })) },
  };
}

let admin: ReturnType<typeof makeAdminMock>;
const createAdminClientMock = vi.fn(() => admin.client);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClientMock(),
}));

// Session client used by writeAudit and the routes/actions.
let sessionClient: Record<string, unknown>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClient,
  isPortalPreview: async () => false,
}));

vi.mock("@/lib/activity/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

beforeEach(() => {
  vi.resetModules();
  createAdminClientMock.mockClear();
  redirectMock.mockClear();
  admin = makeAdminMock({});
  sessionClient = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const identity = { userId: "user-1", email: "invitee@example.com" };
const INVITE_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// 1. Accept requires an explicit action AND a matching verified email.
// ---------------------------------------------------------------------------

describe("verifiedInviteIdentity", () => {
  it("returns null for an unconfirmed email or a user without email", async () => {
    const { verifiedInviteIdentity } = await import("@/lib/actions/invites");
    expect(verifiedInviteIdentity({ id: "u", email: "a@x.com", email_confirmed_at: undefined })).toBeNull();
    expect(verifiedInviteIdentity({ id: "u", email: undefined, email_confirmed_at: "2026-01-01" })).toBeNull();
    expect(verifiedInviteIdentity(null)).toBeNull();
  });

  it("lower-cases the confirmed email", async () => {
    const { verifiedInviteIdentity } = await import("@/lib/actions/invites");
    expect(
      verifiedInviteIdentity({ id: "u", email: " Mixed@Example.COM ", email_confirmed_at: "2026-01-01" }),
    ).toEqual({ userId: "u", email: "mixed@example.com" });
  });
});

describe("acceptInviteForUser", () => {
  it("refuses without a verified identity and never touches the database", async () => {
    const { acceptInviteForUser } = await import("@/lib/actions/invites");
    const result = await acceptInviteForUser(INVITE_ID, null);
    expect(result.ok).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("does not activate an invite addressed to a different email", async () => {
    // The lookup is scoped to invited_email = identity.email, so a row for
    // someone else resolves to nothing.
    admin = makeAdminMock({ "workspace_members.read": { data: null, error: null } });
    const { acceptInviteForUser } = await import("@/lib/actions/invites");

    const result = await acceptInviteForUser(INVITE_ID, identity);

    expect(result.ok).toBe(false);
    expect(admin.calls).toContainEqual({
      table: "workspace_members",
      op: "eq",
      args: ["invited_email", "invitee@example.com"],
    });
    expect(admin.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("claims exactly the named row, re-asserting email + unclaimed in the UPDATE", async () => {
    admin = makeAdminMock({
      "workspace_members.read": {
        data: { id: INVITE_ID, workspace_id: "ws-1", role: "member", invited_project_id: null, invited_email: identity.email },
        error: null,
      },
      "workspace_members.write": { data: { workspace_id: "ws-1" }, error: null },
      "workspaces.read": { data: { slug: "acme" }, error: null },
    });
    const { acceptInviteForUser } = await import("@/lib/actions/invites");

    const result = await acceptInviteForUser(INVITE_ID, identity);

    expect(result).toEqual({ ok: true, workspaceId: "ws-1", workspaceSlug: "acme", role: "member" });
    const updateIndex = admin.calls.findIndex((c) => c.op === "update");
    expect(admin.calls[updateIndex].args[0]).toEqual({ user_id: "user-1", status: "active" });
    const afterUpdate = admin.calls.slice(updateIndex);
    expect(afterUpdate).toContainEqual({ table: "workspace_members", op: "eq", args: ["id", INVITE_ID] });
    expect(afterUpdate).toContainEqual({ table: "workspace_members", op: "eq", args: ["invited_email", identity.email] });
    expect(afterUpdate).toContainEqual({ table: "workspace_members", op: "is", args: ["user_id", null] });
  });
});

describe("declineInviteForUser", () => {
  it("refuses without a verified identity", async () => {
    const { declineInviteForUser } = await import("@/lib/actions/invites");
    expect((await declineInviteForUser(INVITE_ID, null)).ok).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("deletes only a pending row addressed to the identity's email", async () => {
    admin = makeAdminMock({ "workspace_members.write": { data: [{ id: INVITE_ID, workspace_id: "ws-1" }], error: null } });
    const { declineInviteForUser } = await import("@/lib/actions/invites");

    expect(await declineInviteForUser(INVITE_ID, identity)).toEqual({ ok: true });
    expect(admin.calls).toContainEqual({ table: "workspace_members", op: "delete", args: [] });
    expect(admin.calls).toContainEqual({ table: "workspace_members", op: "eq", args: ["invited_email", identity.email] });
    expect(admin.calls).toContainEqual({ table: "workspace_members", op: "eq", args: ["status", "invited"] });
  });
});

describe("acceptInvite Server Action", () => {
  it("derives the identity from the session, not the form", async () => {
    const acceptInviteForUser = vi.fn(async () => ({ ok: false as const, error: "nope" }));
    vi.doMock("@/lib/actions/invites", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/actions/invites")>()),
      acceptInviteForUser,
    }));
    vi.doMock("@/lib/auth/current-user", () => ({
      getCurrentUser: async () => ({
        supabase: {},
        user: { id: "session-user", email: "Session@Example.com", email_confirmed_at: "2026-01-01" },
      }),
    }));
    const { acceptInvite } = await import("@/lib/actions/invite-response");

    const form = new FormData();
    form.set("inviteId", INVITE_ID);
    form.set("email", "attacker@example.com");
    form.set("userId", "attacker");
    const result = await acceptInvite(null, form);

    expect(result).toEqual({ ok: false, error: "nope" });
    expect(acceptInviteForUser).toHaveBeenCalledWith(INVITE_ID, {
      userId: "session-user",
      email: "session@example.com",
    });
    vi.doUnmock("@/lib/actions/invites");
    vi.doUnmock("@/lib/auth/current-user");
  });
});

// ---------------------------------------------------------------------------
// 2. The auth callback no longer auto-accepts.
// ---------------------------------------------------------------------------

describe("/auth/callback", () => {
  const user = { id: "user-1", email: "invitee@example.com", email_confirmed_at: "2026-01-01" };

  function mockPostSignIn(pending: unknown[]) {
    const acceptInviteForUser = vi.fn();
    vi.doMock("@/lib/actions/invites", () => ({
      listPendingInvites: async () => pending,
      verifiedInviteIdentity: () => ({ userId: user.id, email: user.email }),
      acceptInviteForUser,
    }));
    vi.doMock("@/lib/queries/workspaces", () => ({
      getDefaultWorkspaceSlug: async () => ({ slug: "acme", role: "member" }),
    }));
    return acceptInviteForUser;
  }

  beforeEach(() => {
    sessionClient = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({ error: null })),
        getUser: async () => ({ data: { user } }),
      },
    };
  });

  afterEach(() => {
    vi.doUnmock("@/lib/actions/invites");
    vi.doUnmock("@/lib/queries/workspaces");
  });

  async function callback(query: string) {
    const { GET } = await import("@/app/(auth)/auth/callback/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`https://app.example.com/auth/callback${query}`));
  }

  it("sends a user with pending invites to /invites without accepting anything", async () => {
    const acceptInviteForUser = mockPostSignIn([{ id: INVITE_ID }]);
    const response = await callback("?code=abc");

    expect(response.headers.get("location")).toBe("https://app.example.com/invites");
    expect(acceptInviteForUser).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("routes a user with nothing pending to their workspace", async () => {
    mockPostSignIn([]);
    const response = await callback("?code=abc");
    expect(response.headers.get("location")).toBe("https://app.example.com/w/acme");
  });

  it("honours a safe relative `next` and ignores an off-origin one", async () => {
    mockPostSignIn([]);
    expect((await callback("?code=abc&next=%2Fw%2Facme%2Finbox")).headers.get("location")).toBe(
      "https://app.example.com/w/acme/inbox",
    );
    expect((await callback("?code=abc&next=%2F%2Fevil.com")).headers.get("location")).toBe(
      "https://app.example.com/w/acme",
    );
    expect((await callback("?code=abc&next=https%3A%2F%2Fevil.com")).headers.get("location")).toBe(
      "https://app.example.com/w/acme",
    );
  });
});

describe("/auth/confirm", () => {
  it("verifies the token_hash server-side and never accepts invites itself", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    sessionClient = {
      auth: {
        verifyOtp,
        getUser: async () => ({ data: { user: { id: "u", email: "a@x.com", email_confirmed_at: "x" } } }),
      },
    };
    const acceptInviteForUser = vi.fn();
    vi.doMock("@/lib/actions/invites", () => ({
      listPendingInvites: async () => [{ id: INVITE_ID }],
      verifiedInviteIdentity: () => ({ userId: "u", email: "a@x.com" }),
      acceptInviteForUser,
    }));
    const { GET } = await import("@/app/(auth)/auth/confirm/route");
    const { NextRequest } = await import("next/server");

    const response = await GET(
      new NextRequest("https://app.example.com/auth/confirm?token_hash=th&type=invite"),
    );

    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "th" });
    expect(response.headers.get("location")).toBe("https://app.example.com/invites");
    expect(acceptInviteForUser).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/actions/invites");
  });

  it("rejects unsupported OTP types without calling Supabase", async () => {
    const verifyOtp = vi.fn();
    sessionClient = { auth: { verifyOtp } };
    const { GET } = await import("@/app/(auth)/auth/confirm/route");
    const { NextRequest } = await import("next/server");

    const response = await GET(
      new NextRequest("https://app.example.com/auth/confirm?token_hash=th&type=recovery"),
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example.com/sign-in?error=auth_failed");
  });
});

// ---------------------------------------------------------------------------
// 3. Magic-link sign-in: identical response regardless of account existence.
// ---------------------------------------------------------------------------

describe("signInWithMagicLink", () => {
  function form(email: string) {
    const data = new FormData();
    data.set("email", email);
    return data;
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  });

  it("returns the same response for an unknown email as for a known one", async () => {
    const signInWithOtp = vi.fn(async ({ email }: { email: string }) =>
      email === "known@example.com"
        ? { error: null }
        : { error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } },
    );
    sessionClient = { auth: { signInWithOtp } };
    admin = makeAdminMock({ "workspace_members.read": { data: [], error: null } });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    const known = await signInWithMagicLink(null, form("known@example.com"));
    const unknown = await signInWithMagicLink(null, form("unknown@example.com"));

    expect(known).toEqual({ ok: true });
    expect(unknown).toEqual(known);
  });

  it("also masks send/rate-limit failures behind the same response", async () => {
    sessionClient = {
      auth: { signInWithOtp: async () => ({ error: { code: "over_email_send_rate_limit", status: 429, message: "x" } }) },
    };
    admin = makeAdminMock({ "workspace_members.read": { data: [], error: null } });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    expect(await signInWithMagicLink(null, form("known@example.com"))).toEqual({ ok: true });
  });

  it("allows signup when the email has several pending invites (no maybeSingle)", async () => {
    const signInWithOtp = vi.fn(async (_args: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => ({ error: null }));
    sessionClient = { auth: { signInWithOtp } };
    admin = makeAdminMock({ "workspace_members.read": { data: [{ id: "a" }], error: null } });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    await signInWithMagicLink(null, form("Invitee@Example.com"));

    expect(admin.calls).toContainEqual({ table: "workspace_members", op: "limit", args: [1] });
    expect(admin.calls.some((c) => c.op === "maybeSingle")).toBe(false);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "invitee@example.com",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "https://app.example.com/auth/callback",
      },
    });
  });

  it("builds the link from NEXT_PUBLIC_APP_URL, never request headers", async () => {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ origin: "https://evil.example", host: "evil.example" }),
      cookies: async () => ({ get: () => undefined, set: () => {} }),
    }));
    const signInWithOtp = vi.fn(async (_args: { options: { emailRedirectTo: string } }) => ({ error: null }));
    sessionClient = { auth: { signInWithOtp } };
    admin = makeAdminMock({ "workspace_members.read": { data: [], error: null } });
    const { signInWithMagicLink } = await import("@/lib/actions/auth");

    await signInWithMagicLink(null, form("known@example.com"));

    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://app.example.com/auth/callback",
    );
    vi.doUnmock("next/headers");
  });
});

// ---------------------------------------------------------------------------
// 4. Redirect param validation.
// ---------------------------------------------------------------------------

describe("safeNextPath", () => {
  it("accepts root-relative same-origin paths", async () => {
    const { safeNextPath } = await import("@/lib/validation/auth");
    expect(safeNextPath("/w/acme")).toBe("/w/acme");
    expect(safeNextPath("/w/acme?tab=1#x")).toBe("/w/acme?tab=1#x");
  });

  it.each([
    null,
    undefined,
    "",
    "w/acme",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/foo\nbar",
    "/\t/evil.com",
  ])("rejects %j", async (value) => {
    const { safeNextPath } = await import("@/lib/validation/auth");
    expect(safeNextPath(value)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Env flags + app URL.
// ---------------------------------------------------------------------------

describe("env flags", () => {
  it("default ON when unset, explicit parsing otherwise", async () => {
    const { parseBooleanFlag, isWorkspaceCreationAllowed, isPasswordLoginEnabled } = await import("@/lib/env");
    expect(parseBooleanFlag(undefined, true)).toBe(true);
    expect(parseBooleanFlag("", true)).toBe(true);
    expect(parseBooleanFlag(" FALSE ", true)).toBe(false);
    expect(parseBooleanFlag("0", true)).toBe(false);
    expect(parseBooleanFlag("on", false)).toBe(true);
    expect(parseBooleanFlag("garbage", true)).toBe(true);

    vi.stubEnv("ALLOW_WORKSPACE_CREATION", "");
    vi.stubEnv("PASSWORD_LOGIN_ENABLED", "");
    expect(isWorkspaceCreationAllowed()).toBe(true);
    expect(isPasswordLoginEnabled()).toBe(true);
    vi.stubEnv("ALLOW_WORKSPACE_CREATION", "false");
    vi.stubEnv("PASSWORD_LOGIN_ENABLED", "false");
    expect(isWorkspaceCreationAllowed()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);
  });

  it("appUrl uses configuration only and normalises to an origin", async () => {
    const { appUrl } = await import("@/lib/env");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pm.example.com/");
    expect(appUrl()).toBe("https://pm.example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => appUrl()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
