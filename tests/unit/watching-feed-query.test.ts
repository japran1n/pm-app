// Regression test for the `getWatchedTasksForUser: task query failed { code:
// "42703", message: "column tasks.key does not exist" }` bug -- `tasks` has
// no `key` column (same class of bug already fixed in getPersonalTodos, see
// lib/queries/personal-todos.ts's own header comment). This mocks the
// Supabase client used by lib/queries/watching.ts to prove:
//   1. the `tasks` select string never references a bare `key` column, and
//   2. the returned item's `taskKey` is correctly assembled from the
//      embedded `projects(key)` + the task's own `number`.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockTaskWatchersEq2 = vi.fn();
const mockTasksSelect = vi.fn();
const mockProjectsIn = vi.fn();
const mockActivityOrder = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "task_watchers") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: mockTaskWatchersEq2,
            })),
          })),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn((columns: string) => {
            mockTasksSelect(columns);
            return {
              in: vi.fn(() => ({
                is: vi.fn(async () => ({
                  data: [
                    {
                      id: "task-a",
                      title: "Fix login bug",
                      number: 7,
                      project_id: "proj-1",
                      status: "in_progress",
                      due_date: null,
                      updated_at: "2026-06-01T10:00:00.000Z",
                      projects: { key: "PM" },
                    },
                  ],
                  error: null,
                })),
              })),
            };
          }),
        };
      }
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            in: mockProjectsIn,
          })),
        };
      }
      if (table === "task_activity") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              order: mockActivityOrder,
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async () => new Map()),
}));

import { getWatchedTasksForUser } from "@/lib/queries/watching";

describe("getWatchedTasksForUser (query layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskWatchersEq2.mockResolvedValue({
      data: [{ task_id: "task-a" }],
      error: null,
    });
    mockProjectsIn.mockResolvedValue({
      data: [{ id: "proj-1", name: "Alpha" }],
      error: null,
    });
    mockActivityOrder.mockResolvedValue({ data: [], error: null });
  });

  it("never selects a bare `key` column off `tasks` (tasks has no `key` column)", async () => {
    await getWatchedTasksForUser("user-1");

    expect(mockTasksSelect).toHaveBeenCalledTimes(1);
    const columns = mockTasksSelect.mock.calls[0][0] as string;
    // Splitting on top-level commas (not inside an embed's parens) and
    // checking no bare token is exactly "key" -- `projects(key)` is fine,
    // a bare `key` column on `tasks` is not.
    const topLevelFields = columns.split(",").map((s) => s.trim());
    expect(topLevelFields).not.toContain("key");
    expect(columns).toContain("number");
    expect(columns).toContain("projects(key)");
  });

  it("assembles taskKey from the embedded project's key + the task's number", async () => {
    const items = await getWatchedTasksForUser("user-1");

    expect(items).toHaveLength(1);
    expect(items[0].taskKey).toBe("PM-7");
  });
});
