import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock next/navigation's redirect so we can assert the destination without
// Next.js's real throw-based redirect mechanism firing in a unit test.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Chainable query-builder mock covering exactly the calls
// getDefaultWorkspaceSlug makes:
//   .from("workspace_members").select().eq().eq().order().limit().maybeSingle()
//   .from("workspaces").select().eq().maybeSingle()
function makeSupabaseMock(opts: {
  membership: { workspace_id: string } | null;
  workspaceSlug: string | null;
}) {
  const membershipChain = {
    select: () => membershipChain,
    eq: () => membershipChain,
    order: () => membershipChain,
    limit: () => membershipChain,
    maybeSingle: async () => ({ data: opts.membership, error: null }),
  };
  const workspaceChain = {
    select: () => workspaceChain,
    eq: () => workspaceChain,
    maybeSingle: async () => ({
      data: opts.workspaceSlug ? { slug: opts.workspaceSlug } : null,
      error: null,
    }),
  };

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", email: "a@example.com" } },
      }),
    },
    from: (table: string) => {
      if (table === "workspace_members") return membershipChain;
      if (table === "workspaces") return workspaceChain;
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

// Pending-invite lookup goes through the admin client; stubbed here. The
// invite-first redirect has its own coverage in invite-consent.test.ts.
const listPendingInvitesMock = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/actions/invites", () => ({
  listPendingInvites: () => listPendingInvitesMock(),
  verifiedInviteIdentity: () => null,
}));

describe("OnboardingPage membership gate (AS-005)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    listPendingInvitesMock.mockReset();
    listPendingInvitesMock.mockResolvedValue([]);
  });

  it("AS-005: redirects a user WITH an existing active membership to their workspace instead of showing the form", async () => {
    mockSupabase = makeSupabaseMock({
      membership: { workspace_id: "ws-1" },
      workspaceSlug: "acme",
    });

    const { default: OnboardingPage } = await import(
      "@/app/(workspace)/onboarding/page"
    );

    await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/w/acme");
    expect(redirectMock).toHaveBeenCalledWith("/w/acme");
  });

  it("AS-005: renders the create-workspace form for a user with no active membership", async () => {
    mockSupabase = makeSupabaseMock({
      membership: null,
      workspaceSlug: null,
    });

    const { default: OnboardingPage } = await import(
      "@/app/(workspace)/onboarding/page"
    );

    const element = await OnboardingPage();
    expect(redirectMock).not.toHaveBeenCalled();

    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Create your workspace");
  });

  it("SEC 2026-09-24: a user with pending invites is sent to /invites before anything else", async () => {
    mockSupabase = makeSupabaseMock({
      membership: { workspace_id: "ws-1" },
      workspaceSlug: "acme",
    });
    listPendingInvitesMock.mockResolvedValue([
      { id: "i-1", workspaceId: "ws-2", workspaceName: "Other", role: "member" },
    ]);

    const { default: OnboardingPage } = await import(
      "@/app/(workspace)/onboarding/page"
    );

    await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/invites");
  });
});
