// @vitest-environment jsdom
//
// Audit 2026-09-24: guests, viewers and clients do not get team-level
// writes. The server gates (withAuthz's default canTeamWrite, canEditTask
// for task create/edit) refuse them, so the UI must not offer controls that
// would fail, and the Tools are hidden from roles the tool routes refuse.
// Guests keep comments, reactions, attachments and time entries (canWrite).
//
// Fully mocked: no Supabase project is touched.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  canReadSitemaps,
  canUseTeamTools,
  canWrite,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { PALETTE_ACTIONS } from "@/components/command/actions";

vi.mock("@/lib/actions/tasks", () => ({
  updateTaskTags: vi.fn(async () => ({ ok: true, data: { tags: [] } })),
  createTask: vi.fn(async () => ({ ok: true, data: { id: "t1" } })),
  editTask: vi.fn(async () => ({ ok: true, data: {} })),
  assignTask: vi.fn(async () => ({ ok: true, data: {} })),
  deleteTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/actions/checklist", () => ({
  addChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
  renameChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  reorderChecklistItem: vi.fn(),
}));

let currentPath = "/w/acme";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
  }),
}));

// createTaskForUser's collaborators (server-side, mocked).
let membershipRole: WorkspaceRole = "member";
const adminFromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return {
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                id: "00000000-0000-4000-8000-000000000010",
                workspace_id: "00000000-0000-4000-8000-000000000011",
                deleted_at: null,
                visibility: "workspace",
              },
              error: null,
            }),
          }),
        }),
      }),
    };
  }
  throw new Error(`Unexpected table in test mock: ${table}`);
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFromMock, rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: membershipRole }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { TagsEditor } from "@/components/task/tags-editor";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { Checklist } from "@/components/task/checklist";
import { MembershipProvider } from "@/components/auth/membership-provider";
import { ToolGate } from "@/components/tools/tool-gate";
import { AppSidebar } from "@/components/nav/app-sidebar";

afterEach(() => {
  cleanup();
  currentPath = "/w/acme";
});

const NON_TEAM: WorkspaceRole[] = ["guest", "viewer", "client"];
const TEAM: WorkspaceRole[] = ["owner", "admin", "member"];

describe("tool predicates", () => {
  it("team tools are owner/admin/member only", () => {
    for (const role of TEAM) expect(canUseTeamTools({ role })).toBe(true);
    for (const role of NON_TEAM) expect(canUseTeamTools({ role })).toBe(false);
  });

  it("sitemaps are readable by the team and viewers, not guests or clients", () => {
    for (const role of [...TEAM, "viewer" as const]) {
      expect(canReadSitemaps({ role })).toBe(true);
    }
    expect(canReadSitemaps({ role: "guest" })).toBe(false);
    expect(canReadSitemaps({ role: "client" })).toBe(false);
  });

  it("guests keep the contribution gate (comments/attachments/time entries)", () => {
    expect(canWrite({ role: "guest" })).toBe(true);
  });
});

describe("command palette create actions", () => {
  const visible = (id: string, role: WorkspaceRole) =>
    PALETTE_ACTIONS.find((a) => a.id === id)!.isVisible({ role, workspaceSlug: "acme" });

  it("hides Create task and Create project from a guest", () => {
    expect(visible("create-task", "guest")).toBe(false);
    expect(visible("create-project", "guest")).toBe(false);
  });

  it("shows both to a member", () => {
    expect(visible("create-task", "member")).toBe(true);
    expect(visible("create-project", "member")).toBe(true);
  });
});

describe("task controls are disabled for a guest", () => {
  it("TagsEditor add input is disabled for a guest", () => {
    render(createElement(TagsEditor, { taskId: "task-1", tags: [], currentUserRole: "guest" }));
    expect(screen.getByPlaceholderText("Add a tag")).toBeDisabled();
  });

  it("Checklist add input is disabled for a guest", () => {
    render(
      createElement(Checklist, {
        taskId: "task-1",
        items: [{ id: "item-1", content: "Write tests", isChecked: false, position: 1 }],
        currentUserRole: "guest",
      }),
    );
    expect(screen.getByPlaceholderText("Add an item…")).toBeDisabled();
  });

  it("NewTaskDialog trigger is disabled for a guest", () => {
    render(
      createElement(
        MembershipProvider,
        { role: "guest", projectRoles: {} },
        <NewTaskDialog projectId="11111111-1111-1111-1111-111111111111" assigneeOptions={[]} />,
      ),
    );
    expect(screen.getByRole("button", { name: /new task/i })).toBeDisabled();
  });
});

describe("ToolGate", () => {
  function renderGate(role: WorkspaceRole | null, access: "team" | "sitemaps") {
    const gate = <ToolGate access={access}><span>tool card</span></ToolGate>;
    render(role ? createElement(MembershipProvider, { role, projectRoles: {} }, gate) : gate);
    return screen.queryByText("tool card");
  }

  it("hides team tools from guest and viewer, shows them to a member", () => {
    expect(renderGate("guest", "team")).toBeNull();
    cleanup();
    expect(renderGate("viewer", "team")).toBeNull();
    cleanup();
    expect(renderGate("member", "team")).not.toBeNull();
  });

  it("shows the sitemap card to a viewer but not a guest", () => {
    expect(renderGate("viewer", "sitemaps")).not.toBeNull();
    cleanup();
    expect(renderGate("guest", "sitemaps")).toBeNull();
  });

  it("renders without a provider (isolated render)", () => {
    expect(renderGate(null, "team")).not.toBeNull();
  });
});

describe("sidebar Tools band", () => {
  const props = {
    workspaceSlug: "acme",
    workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
    currentWorkspaceId: "w1",
    currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  };

  function renderSidebar(role: WorkspaceRole) {
    render(
      createElement(
        MembershipProvider,
        { role, projectRoles: {} },
        <AppSidebar {...props} isGuest={role === "guest"} />,
      ),
    );
  }

  it("a guest sees no Tools links", () => {
    renderSidebar("guest");
    expect(screen.queryByRole("link", { name: /HTML → Webflow/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Webflow Code Editor/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Sitemap Builder/ })).toBeNull();
  });

  it("a viewer sees only the Sitemap Builder", () => {
    renderSidebar("viewer");
    expect(screen.queryByRole("link", { name: /HTML → Webflow/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Webflow Code Editor/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /Sitemap Builder/ }).length).toBeGreaterThan(0);
  });

  it("a member sees all three tools", () => {
    renderSidebar("member");
    expect(screen.getAllByRole("link", { name: /HTML → Webflow/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Webflow Code Editor/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Sitemap Builder/ }).length).toBeGreaterThan(0);
  });
});

describe("createTaskForUser server gate", () => {
  beforeEach(() => {
    adminFromMock.mockClear();
  });

  it.each(["guest", "viewer", "client"] as const)("refuses a %s", async (role) => {
    membershipRole = role;
    const { createTaskForUser } = await import("@/lib/tasks/create");
    const result = await createTaskForUser("00000000-0000-4000-8000-000000000012", {
      projectId: "00000000-0000-4000-8000-000000000010",
      title: "Should not be created",
    });
    expect(result.ok).toBe(false);
    // Refused at the role gate: nothing past the project lookup ran.
    expect(adminFromMock.mock.calls.map(([t]) => t)).toEqual(["projects"]);
  });
});
