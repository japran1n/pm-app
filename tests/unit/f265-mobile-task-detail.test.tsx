// @vitest-environment jsdom
//
// F265 (AS-516, AS-518): mobile task detail (full-screen Sheet on phone
// widths) and 44px mobile tap targets.
//
// AS-516 is proven by rendering the REAL <Board> + <TaskDetailSheet>
// (same "open via ?taskId=" pattern F246/F247's own tests already use --
// Radix/base-ui's Sheet only portals its content when `open`, so a real
// jsdom render is needed, not a source-text regex alone) and asserting
// on the actual rendered SheetContent element's class list: it must
// carry the `max-sm:` overrides that make it full-width/full-height/
// borderless below the `sm` breakpoint, on the SAME data-attribute-
// qualified selectors the base Sheet's non-conditional `w-3/4` rule uses
// (a bare `max-sm:w-full` on its own would lose the CSS specificity tie
// -- see the component's own doc comment) -- this is jsdom, which has no
// real layout/media-query engine, so it cannot verify the CSS actually
// *computes* to full-screen at 375px; it verifies the correct override
// mechanism is present and wired to the right element, which is what a
// jsdom test can honestly assert. See this feature's handoff for the
// CSS-cascade reasoning and the explicit note that a live-browser/
// getComputedStyle pass is still pending orchestrator review.
//
// AS-518 is proven the same way for a mix of DOM measurement (jsdom does
// give real getBoundingClientRect-independent computed inline styles,
// but NOT real layout — Tailwind classes are asserted by class-list
// presence, matching AS-516's approach) across every control this
// feature's audit named: the mobile nav hamburger trigger, the mobile
// nav Links, and the Sheet's own close button.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

// jsdom has no real `matchMedia` implementation (lib/hooks/use-media-
// query.ts's `useMediaQuery` is defensive against that and falls back to
// `false`/desktop when it's absent) -- stubbed here as "always matches"
// (simulating a phone-width viewport) so this file's collapse-toggle
// test (which needs `isMobile` true for a trigger click to actually
// change `effectiveOpen`) can exercise the real mobile behaviour rather
// than the desktop-forced-open fallback.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Mobile task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        projectKey: "MOB",
        number: 1,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("taskId=t1"),
}));

vi.mock("@/lib/actions/comments", () => ({
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import { AppSidebar } from "@/components/nav/app-sidebar";
import type { TaskCardTask } from "@/components/task/task-card";


// Realtime: mock the Supabase browser client so mounting this component
// never opens a real WebSocket. jsdom's undici-based WebSocket polyfill
// throws "TypeError: The \"event\" argument must be an instance of Event"
// against a live connection (see vitest.config.ts's own comment on why
// jsdom is opt-in per file), which escapes as an unhandled exception
// outside any test and fails the process even though every test passes.
// Same "channel().on().subscribe()" fake shape as
// tests/unit/f022-board-realtime-guard-call-site.test.tsx.
function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Mobile task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
    projectKey: "MOB",
    number: 1,
  },
];

describe("Task detail Sheet is full-screen on phone widths (F265, AS-516)", () => {
  it("test_AS_516_sheet_content_carries_data_attribute_qualified_max_sm_full_screen_overrides", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Mobile task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const sheetContent = document.querySelector('[data-slot="sheet-content"]');
    expect(sheetContent).not.toBeNull();
    const classList = sheetContent!.className;

    // Full width below `sm`, on the data-attribute-qualified selector
    // that actually wins the cascade against the base Sheet's
    // unconditional `data-[side=right]:w-3/4`/`data-[side=left]:w-3/4`.
    expect(classList).toMatch(/max-sm:data-\[side=right\]:w-full/);
    expect(classList).toMatch(/max-sm:data-\[side=left\]:w-full/);
    expect(classList).toMatch(/max-sm:data-\[side=right\]:max-w-none/);
    // Full height + no floating-sheet chrome at that width.
    expect(classList).toMatch(/max-sm:h-svh/);
    expect(classList).toMatch(/max-sm:border-0/);
  });

  it("test_AS_516_header_carrying_the_task_key_is_sticky_on_phone_widths", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Mobile task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const header = document.querySelector('[data-slot="sheet-header"]');
    expect(header).not.toBeNull();
    expect(header!.className).toMatch(/max-sm:sticky/);
    expect(header!.className).toMatch(/max-sm:top-0/);

    // The task key badge (the "carries the task key" half of the
    // requirement) is rendered inside that same sticky header element.
    expect(within(header as HTMLElement).getByText("MOB-1")).toBeInTheDocument();

    // The Sheet's close control (from components/ui/sheet.tsx, shared by
    // every Sheet in the app) is reachable and is itself a 44px target
    // (AS-518) -- verified in the dedicated AS-518 describe block below,
    // asserted here only that it exists so the "close control" half of
    // the sticky-header requirement is satisfied.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("test_AS_516_collapsible_sections_exist_for_description_checklist_subtasks_comments_activity_and_time", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Mobile task", { exact: false }),
      ).toBeInTheDocument(),
    );

    // Each of these renders a collapse trigger button whose accessible
    // name matches the section, present in the DOM (mobile-only visible
    // via a `hidden max-sm:flex` class, not conditionally mounted --
    // jsdom has no viewport, so "present" is what's assertable here).
    for (const title of [
      "Description",
      "Subtasks",
      "Checklist",
      "Comments & activity",
      "Time tracking",
    ]) {
      const trigger = screen.getByRole("button", { name: title });
      expect(trigger).toBeInTheDocument();
      expect(trigger.className).toMatch(/max-sm:flex/);
      expect(trigger.className).toMatch(/hidden/);
    }
  });

  it("test_AS_516_collapsing_a_section_via_its_trigger_hides_its_content", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Mobile task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const checklistTrigger = screen.getByRole("button", { name: "Checklist" });
    // Expanded by default (AS-516's spec: sections "become collapsible",
    // not "start collapsed") -- data-panel-open is base-ui's Collapsible
    // convention for the trigger's own state marker.
    expect(checklistTrigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(checklistTrigger);

    await waitFor(() =>
      expect(checklistTrigger).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("Mobile navigation tap targets are at least 44px (F265, AS-518)", () => {
  it("test_AS_518_sheet_close_button_is_44px_on_phone_widths", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Mobile task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton.className).toMatch(/max-sm:size-11/);
  });

  it("test_AS_518_mobile_hamburger_trigger_is_44px", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
      }),
    );

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger.className).toMatch(/max-md:size-11/);
  });

  it("test_AS_518_mobile_nav_links_have_a_44px_minimum_tap_height", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
      }),
    );

    // Two copies exist (desktop <aside> + mobile Sheet render the same
    // SidebarContent) -- assert every one of them carries the mobile
    // 44px floor, not just the first.
    const dashboardLinks = screen.getAllByRole("link", { name: /Dashboard/i });
    expect(dashboardLinks.length).toBeGreaterThan(0);
    for (const link of dashboardLinks) {
      expect(link.className).toMatch(/max-md:min-h-11/);
    }

    const profileLinks = screen.getAllByRole("link", { name: /Test User/i });
    expect(profileLinks.length).toBeGreaterThan(0);
    for (const link of profileLinks) {
      expect(link.className).toMatch(/max-md:min-h-11/);
    }
  });

  // F332 (M17 scrutiny BLOCKER-1): the notification bell trigger and the
  // Projects section's own controls (row Link, "Projects" collapsible
  // trigger, favourite star) were structurally invisible to the tests
  // above -- the bell wasn't asserted on at all, and `projects` was never
  // passed so ProjectNavList rendered its empty state, not its rows. This
  // renders AppSidebar WITH a non-empty `projects` array and asserts on
  // every one of those four previously-missed controls.
  const PROJECTS = [
    { id: "p1", name: "Acme Website", key: "AW", isFavorite: false },
  ];

  it("test_AS_518_mobile_notification_bell_trigger_is_44px", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
        projects: PROJECTS,
      }),
    );

    // Two copies exist (desktop header bar + mobile top bar) -- assert
    // every one of them, not just the first.
    const bellTriggers = screen.getAllByRole("button", { name: /Notifications/i });
    expect(bellTriggers.length).toBeGreaterThan(0);
    for (const trigger of bellTriggers) {
      expect(trigger.className).toMatch(/max-md:size-11/);
    }
  });

  it("test_AS_518_project_row_has_a_44px_minimum_tap_height", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
        projects: PROJECTS,
      }),
    );

    const projectLinks = screen.getAllByRole("link", { name: /Acme Website/i });
    expect(projectLinks.length).toBeGreaterThan(0);
    for (const link of projectLinks) {
      expect(link.className).toMatch(/max-md:min-h-11/);
    }
  });

  it("test_AS_518_projects_collapsible_trigger_has_a_44px_minimum_tap_height", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
        projects: PROJECTS,
      }),
    );

    const projectsTriggers = screen.getAllByRole("button", { name: "Projects" });
    expect(projectsTriggers.length).toBeGreaterThan(0);
    for (const trigger of projectsTriggers) {
      expect(trigger.className).toMatch(/max-md:min-h-11/);
    }
  });

  it("test_AS_518_project_favorite_star_is_44px_on_phone_widths", () => {
    render(
      createElement(AppSidebar, {
        workspaceSlug: "acme",
        workspaces: [],
        currentWorkspaceId: "w1",
        currentUser: { id: "u1", name: "Test User", email: "t@example.com" },
        projects: PROJECTS,
      }),
    );

    const starButtons = screen.getAllByRole("button", {
      name: /favourites/i,
    });
    expect(starButtons.length).toBeGreaterThan(0);
    for (const star of starButtons) {
      expect(star.className).toMatch(/max-md:size-11/);
    }
  });
});
