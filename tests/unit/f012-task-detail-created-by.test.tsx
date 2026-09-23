// @vitest-environment jsdom
//
// F012 (TT-024): the task detail sheet's read-only "Created by" row —
// author avatar + name + creation date (mono, "11 Sep 2026" via
// formatTaskDate). Mirrors tests/unit/f005-task-detail-sheet-page-fields
// .test.tsx's own pattern: mounting the real <Board>, mocking
// `@/components/ui/select` with a bare native <select>, and mocking
// `next/navigation`'s `useSearchParams` to a fixed `?taskId=t1`.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: { userIds: [] } })),
}));

import { Board } from "@/components/board/board";
import type { TaskCardTask } from "@/components/task/task-card";
import type { TaskDetailSheetMember } from "@/components/task/task-detail-sheet";

function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
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

const MEMBERS: TaskDetailSheetMember[] = [
  { userId: "user-author", email: "alex@example.com", name: "Alex Author" },
];

async function openSheet() {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
      members: MEMBERS,
    }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(screen.getByDisplayValue("Board task", { exact: false })).toBeInTheDocument(),
  );
}

describe("TaskDetailSheet Created by row (F012, TT-024)", () => {
  it("test_TT_024_shows_author_name_and_created_date_in_mono", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({
          id: taskId,
          authorId: "user-author",
          createdAt: "2026-09-11T10:00:00.000Z",
        }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    const row = await screen.findByTestId("task-created-by");
    expect(row).toHaveTextContent("Alex Author");
    expect(row).toHaveTextContent("11 Sep 2026");
  });

  it("test_TT_024_renders_nothing_when_author_id_is_null", async () => {
    getTaskDetail.mockImplementationOnce(async (taskId: string) => ({
      ok: true,
      data: {
        task: baseTask({ id: taskId, authorId: null, createdAt: "2026-09-11T10:00:00.000Z" }),
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }));

    await openSheet();

    expect(screen.queryByTestId("task-created-by")).not.toBeInTheDocument();
  });
});
