// F001 (missions/20260914-portal-simplify, AS-001/AS-002): unit coverage
// for getPortalFiles' new projectId scoping (lib/queries/portal.ts).
//
// Before this fix, `getPortalFiles` took only a workspace id and returned
// every attachment from every readable project in that workspace,
// including projects with `portal_enabled=false` -- a client on projects A
// and B viewing `p/A/files` saw B's attachments too, and a portal-disabled
// project's attachments leaked into any portal Files view. The `projects`
// read now filters on both `id` (the requested project) and
// `portal_enabled=true`, the same load-bearing reason
// `getPortalRequests`/`getPortalProjectOptions` state on their own copies
// of this filter.
//
// Same mocked-Supabase-client + `applyFilters` shape as
// tests/unit/portal-phases-query.test.ts / portal-approvals-query.test.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let projectRows: Row[];
let taskRows: Row[];
let attachmentRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: applyFilters(projectRows, filters), error: null }),
            };
            return builder;
          }),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: applyFilters(taskRows, filters), error: null }),
            };
            return builder;
          }),
        };
      }
      if (table === "attachments") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              order: vi.fn(async () => {
                return { data: applyFilters(attachmentRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getPortalFiles } from "@/lib/queries/portal";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  projectRows = [];
  taskRows = [];
  attachmentRows = [];
});

describe("getPortalFiles — F001 AS-001: scoped to the requested project only", () => {
  it("test_AS_001_client_on_two_projects_sees_only_the_requested_projects_files", async () => {
    projectRows = [
      { id: PROJECT_A, workspace_id: WORKSPACE_ID, deleted_at: null, portal_enabled: true, name: "Project A" },
      { id: PROJECT_B, workspace_id: WORKSPACE_ID, deleted_at: null, portal_enabled: true, name: "Project B" },
    ];
    taskRows = [
      { id: "task-a", title: "Task A", project_id: PROJECT_A, client_visible: true, deleted_at: null },
      { id: "task-b", title: "Task B", project_id: PROJECT_B, client_visible: true, deleted_at: null },
    ];
    attachmentRows = [
      { id: "att-a", file_name: "a.pdf", created_at: "2026-01-01T00:00:00Z", task_id: "task-a" },
      { id: "att-b", file_name: "b.pdf", created_at: "2026-01-01T00:00:00Z", task_id: "task-b" },
    ];

    const files = await getPortalFiles(WORKSPACE_ID, PROJECT_A);

    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("att-a");
    expect(files.every((f) => f.projectId === PROJECT_A)).toBe(true);
  });
});

describe("getPortalFiles — F001 AS-002: portal_enabled=false projects never appear", () => {
  it("test_AS_002_portal_disabled_project_returns_no_files_even_when_requested_directly", async () => {
    projectRows = [
      { id: PROJECT_A, workspace_id: WORKSPACE_ID, deleted_at: null, portal_enabled: false, name: "Project A" },
    ];
    taskRows = [
      { id: "task-a", title: "Task A", project_id: PROJECT_A, client_visible: true, deleted_at: null },
    ];
    attachmentRows = [
      { id: "att-a", file_name: "a.pdf", created_at: "2026-01-01T00:00:00Z", task_id: "task-a" },
    ];

    const files = await getPortalFiles(WORKSPACE_ID, PROJECT_A);

    expect(files).toEqual([]);
  });

  it("test_AS_002_portal_disabled_project_files_absent_from_a_sibling_projects_view", async () => {
    projectRows = [
      { id: PROJECT_A, workspace_id: WORKSPACE_ID, deleted_at: null, portal_enabled: true, name: "Project A" },
      { id: PROJECT_B, workspace_id: WORKSPACE_ID, deleted_at: null, portal_enabled: false, name: "Project B" },
    ];
    taskRows = [
      { id: "task-a", title: "Task A", project_id: PROJECT_A, client_visible: true, deleted_at: null },
      { id: "task-b", title: "Task B", project_id: PROJECT_B, client_visible: true, deleted_at: null },
    ];
    attachmentRows = [
      { id: "att-a", file_name: "a.pdf", created_at: "2026-01-01T00:00:00Z", task_id: "task-a" },
      { id: "att-b", file_name: "b.pdf", created_at: "2026-01-01T00:00:00Z", task_id: "task-b" },
    ];

    const files = await getPortalFiles(WORKSPACE_ID, PROJECT_A);

    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("att-a");

    const filesB = await getPortalFiles(WORKSPACE_ID, PROJECT_B);
    expect(filesB).toEqual([]);
  });
});
