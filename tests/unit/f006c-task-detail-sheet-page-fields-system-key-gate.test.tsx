// @vitest-environment jsdom
//
// F006c (missions/20260903-portal, AS-014): TaskDetailSheet's Page
// slug/order fields gate on the task type's `system_key`, not its
// `name` — this feature's own Definition of done, failure test: "a
// workspace whose page type is named 'Sida' but carries
// `system_key='page'` shows the page fields in the sheet and orders
// correctly in the portal." Before this feature, the gate at
// task-detail-sheet.tsx was `taskTypeName?.trim().toLowerCase() ===
// "page"` (M1-scrutiny.md's B4) — exactly the workspace F005b exists to
// serve (a page type named "Sida") could never see or order these
// fields, and the converse (an unrelated type renamed to "Page") would
// show them on tasks the Pages view would never list.
//
// Mirrors tests/unit/f005-task-detail-sheet-page-fields.test.tsx's own
// pattern exactly.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
// Audit fix: TaskDetailSheet unconditionally mounts CustomFieldsSection
// and PageLinksEditor, both of which call a server action on mount
// (getCustomFieldsForTaskAction / getPageLinksForTaskAction). Those
// actions reach lib/supabase/server.ts's createClient(), which calls
// next/headers's cookies() outside a request scope in Vitest and rejects
// asynchronously, after this file's own assertions have already run --
// an unhandled rejection attributed to whichever file happens to be
// mid-flight, unrelated to what this file actually tests. Mock both
// action modules the same way sibling tests already mock
// @/lib/actions/tasks etc.
vi.mock("@/lib/actions/custom-fields", () => ({
  getCustomFieldsForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  setTaskCustomFieldValue: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/actions/page-links", () => ({
  getPageLinksForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createPageLink: vi.fn(),
  updatePageLink: vi.fn(),
  deletePageLink: vi.fn(),
}));


process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string | null) => void;
    disabled?: boolean;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        value,
        disabled,
        onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
      },
      children,
    ),
  SelectTrigger: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectValue: () => null,
}));

function baseTask(overrides: Record<string, unknown>) {
  return {
    id: "t1",
    title: "Board task",
    description: null,
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    tags: [],
    projectId: "project-1",
    ...overrides,
  };
}

const getTaskDetail = vi.fn(async (taskId: string) => ({
  ok: true,
  data: {
    task: baseTask({ id: taskId }),
    comments: [],
    attachments: [],
    currentUserId: "user-1",
    currentUserRole: "member",
  },
}));

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: (taskId: string) => getTaskDetail(taskId),
}));

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({ ok: true, data: { phases: [] } })),
  setTaskPhase: vi.fn(async () => ({ ok: true, data: { id: "t1", phaseId: null } })),
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
    title: "Board task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheet() {
  render(
    createElement(Board, { projectId: "project-1", initialTasks: TASKS, timezone: "UTC" }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(screen.getByDisplayValue("Board task", { exact: false })).toBeInTheDocument(),
  );
}

describe("TaskDetailSheet page fields gate on system_key, not name (F006c, AS-014)", () => {
  it("test_AS_014_shows_page_fields_for_a_type_named_Sida_that_carries_system_key_page", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Sida",
          taskTypeSystemKey: "page",
          pageSlug: "om-oss",
          pageOrder: 1,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.getByTestId("page-fields")).toBeInTheDocument();
    expect(screen.getByLabelText("Page slug")).toHaveValue("om-oss");
    expect(screen.getByLabelText("Page order")).toHaveValue(1);
  });

  it("test_AS_014_hides_page_fields_for_a_type_named_Page_that_carries_no_system_key", async () => {
    // The converse trigger M1-scrutiny.md's B4 names: an unrelated type
    // renamed to "Page" (permitted — the unique index is on name) must
    // NOT show the page fields just because of its name; only
    // `system_key = 'page'` does.
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "Page",
          taskTypeSystemKey: null,
          pageSlug: null,
          pageOrder: null,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.queryByTestId("page-fields")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Page slug")).not.toBeInTheDocument();
  });

  it("test_AS_014_hides_page_fields_for_a_task_type_with_an_unrelated_system_key", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          taskTypeName: "QA",
          taskTypeSystemKey: "qa",
          pageSlug: null,
          pageOrder: null,
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.queryByTestId("page-fields")).not.toBeInTheDocument();
  });
});
