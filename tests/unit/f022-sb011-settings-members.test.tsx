// F022 (SB-011): render the real Settings page and the real Members page for
// owner and admin and assert observable output (a real link, real heading),
// instead of grepping page source.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let role: "owner" | "admin" | "member" | "viewer" | "client" | "guest" = "owner";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ push() {}, refresh() {} }),
  usePathname: () => "/w/acme/settings",
}));
vi.mock("@/lib/queries/workspaces", () => ({
  getWorkspaceContext: async () => ({
    user: { id: "u1" },
    workspace: { id: "w1", name: "Acme", slug: "acme", logo_url: null },
    role,
  }),
}));
vi.mock("@/lib/queries/members", () => ({
  getWorkspaceMembers: async () => ({
    active: [{ id: "m1", userId: "u1", role: "owner", email: "o@example.com", name: "Olive", avatarUrl: null, statusNote: null, statusNoteUntil: null }],
    pending: [],
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "order"]) q[k] = () => q;
    q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return { from: () => q };
  },
}));
// Interactive client leaves are irrelevant to routing; stub them.
vi.mock("@/components/workspace/workspace-general-form", () => ({ WorkspaceGeneralForm: () => null }));
vi.mock("@/components/workspace/delete-workspace-dialog", () => ({ DeleteWorkspaceDialog: () => null }));
vi.mock("@/components/invite-member-form", () => ({ InviteMemberForm: () => null }));
vi.mock("@/components/revoke-invite-button", () => ({ RevokeInviteButton: () => null }));
vi.mock("@/components/member-role-select", () => ({ MemberRoleSelect: () => null }));
vi.mock("@/components/remove-member-button", () => ({ RemoveMemberButton: () => null }));
vi.mock("@/components/transfer-ownership-dialog", () => ({ TransferOwnershipDialog: () => null }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

import SettingsPage from "@/app/(workspace)/w/[workspaceSlug]/settings/page";
import MembersPage from "@/app/(workspace)/w/[workspaceSlug]/settings/members/page";

const params = { params: Promise.resolve({ workspaceSlug: "acme" }) };

describe("SB-011: Members reachable via Settings", () => {
  for (const r of ["owner", "admin"] as const) {
    it(`test_SB_011_${r}_sees_members_link_on_settings_and_members_page_renders`, async () => {
      role = r;
      const settings = renderToStaticMarkup(await SettingsPage(params));
      expect(settings).toMatch(/<a[^>]*href="\/w\/acme\/settings\/members"[^>]*>\s*Members\s*<\/a>/);

      const members = renderToStaticMarkup(await MembersPage(params));
      expect(members).toContain(">Members</h1>");
      expect(members).toContain("Active members");
    });
  }

  // Broader role coverage (F026): narrowing canViewMembersList to owner/admin
  // fails the member/viewer cases; dropping its client check fails the client case.
  for (const r of ["member", "viewer"] as const) {
    it(`test_SB_011_${r}_sees_members_link_and_members_page_renders`, async () => {
      role = r;
      const settings = renderToStaticMarkup(await SettingsPage(params));
      expect(settings).toMatch(/<a[^>]*href="\/w\/acme\/settings\/members"[^>]*>\s*Members\s*<\/a>/);
      const members = renderToStaticMarkup(await MembersPage(params));
      expect(members).toContain(">Members</h1>");
    });
  }

  it("test_SB_011_client_is_denied_members_page_and_sees_no_members_link", async () => {
    role = "client";
    await expect(MembersPage(params)).rejects.toThrow("NEXT_REDIRECT:/w/acme");
    const settings = renderToStaticMarkup(await SettingsPage(params));
    expect(settings).not.toContain("/settings/members");
  });

  it("test_SB_011_guest_is_denied_members_page", async () => {
    role = "guest";
    await expect(MembersPage(params)).rejects.toThrow("NEXT_REDIRECT:/w/acme");
  });
});
