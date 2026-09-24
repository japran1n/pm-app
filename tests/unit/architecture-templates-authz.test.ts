// Project-level authorization for the Architecture board, templates and
// sidebar reorder. These actions write through the service-role client, so
// RLS never runs; the checks under test are the only enforcement.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_PRIVATE = "44444444-4444-4444-8444-444444444444";
const PAGE_A = "55555555-5555-4555-8555-555555555555";
const SECTION_A = "66666666-6666-4666-8666-666666666666";
const PLAIN_TASK = "77777777-7777-4777-8777-777777777777";
const PLAIN_SUBTASK = "88888888-8888-4888-8888-888888888888";
const PAGE_PRIVATE = "99999999-9999-4999-8999-999999999999";
const TEMPLATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = Record<string, unknown>;
type Filter = { method: string; args: unknown[] };

let role: string;
let projectMemberships: Set<string>;
let db: Record<string, Row[]>;
let writes: Array<{ table: string; method: string; payload: unknown; filters: Filter[] }>;
let rpcCalls: string[];

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(({ method, args }) => {
    const [column, value, extra] = args as [string, unknown, unknown];
    switch (method) {
      case "eq":
        return row[column] === value;
      case "neq":
        return row[column] !== value;
      case "is":
        return (row[column] ?? null) === value;
      case "in":
        return (value as unknown[]).includes(row[column]);
      case "not":
        return value === "is" && extra === null ? row[column] != null : true;
      default:
        return true;
    }
  });
}

function makeBuilder(table: string) {
  const filters: Filter[] = [];
  let write: { method: string; payload: unknown } | null = null;
  let headCount = false;

  const run = async (single: boolean) => {
    if (write) {
      writes.push({ table, ...write, filters: [...filters] });
      const data =
        write.method === "insert" ? { id: "new-id", ...(write.payload as Row) } : [];
      return { data, error: null };
    }
    const rows = (db[table] ?? []).filter((row) => matches(row, filters));
    if (headCount) return { data: null, count: rows.length, error: null };
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };

  const builder: Record<string, unknown> = {};
  builder.select = (_columns?: string, options?: { head?: boolean }) => {
    if (options?.head) headCount = true;
    return builder;
  };
  for (const method of ["eq", "neq", "is", "in", "not"]) {
    builder[method] = (...args: unknown[]) => {
      filters.push({ method, args });
      return builder;
    };
  }
  for (const method of ["order", "limit"]) builder[method] = () => builder;
  for (const method of ["insert", "update", "upsert", "delete"]) {
    builder[method] = (payload?: unknown) => {
      write = { method, payload };
      return builder;
    };
  }
  builder.maybeSingle = () => run(true);
  builder.single = () => run(true);
  builder.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    run(false).then(resolve, reject);
  return builder;
}

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => {
      if (table === "workspace_members") {
        const builder = makeBuilder(table);
        builder.maybeSingle = async () => ({ data: role ? { role } : null, error: null });
        return builder;
      }
      if (table === "project_members") {
        const builder = makeBuilder(table);
        const filters: Filter[] = [];
        for (const method of ["eq", "in"]) {
          builder[method] = (...args: unknown[]) => {
            filters.push({ method, args });
            return builder;
          };
        }
        const rows = () =>
          [...projectMemberships]
            .map((projectId) => ({ project_id: projectId, user_id: USER_ID }))
            .filter((row) => matches(row, filters));
        builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
        builder.then = (resolve: (r: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve);
        return builder;
      }
      return makeBuilder(table);
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: name === "ensure_task_type" ? "type-id" : true, error: null };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
  isPortalPreview: async () => false,
  PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE: "preview",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function project(id: string, visibility: "workspace" | "private") {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    visibility,
    deleted_at: null,
    sidebar_position: null,
    created_at: "2026-01-01",
    workspaces: { slug: "acme" },
  };
}

function task(fields: Row): Row {
  return {
    deleted_at: null,
    page_slug: null,
    parent_task_id: null,
    component_id: null,
    client_visible: false,
    title: "Task",
    projects: { workspace_id: WORKSPACE_ID, workspaces: { slug: "acme" } },
    ...fields,
  };
}

beforeEach(() => {
  vi.resetModules();
  role = "member";
  projectMemberships = new Set();
  writes = [];
  rpcCalls = [];
  db = {
    projects: [project(PROJECT_A, "workspace"), project(PROJECT_PRIVATE, "private")],
    tasks: [
      task({ id: PAGE_A, project_id: PROJECT_A, page_slug: "home" }),
      task({ id: SECTION_A, project_id: PROJECT_A, parent_task_id: PAGE_A }),
      task({ id: PLAIN_TASK, project_id: PROJECT_A }),
      task({ id: PLAIN_SUBTASK, project_id: PROJECT_A, parent_task_id: PLAIN_TASK }),
      task({ id: PAGE_PRIVATE, project_id: PROJECT_PRIVATE, page_slug: "secret" }),
    ],
    task_templates: [
      {
        id: TEMPLATE_ID,
        workspace_id: WORKSPACE_ID,
        kind: "task",
        created_by: USER_ID,
        name: "T",
        payload: {
          title: "From template",
          description: null,
          description_json: null,
          priority: "none",
          checklistItems: [],
          estimate_minutes: null,
          tags: [],
          assigneeIds: [],
        },
      },
    ],
    workspaces: [{ id: WORKSPACE_ID, slug: "acme" }],
  };
});

const taskWrites = () => writes.filter((w) => w.table === "tasks");

describe("architecture writes: guest outside the project", () => {
  beforeEach(() => {
    role = "guest";
  });

  it("refuses createPage, renamePage and reorderPages without writing", async () => {
    const { createPage, renamePage, reorderPages } = await import(
      "@/lib/actions/architecture"
    );

    const created = await createPage(PROJECT_A, {
      name: "New",
      slug: "new",
      page_kind: "static",
    });
    const renamed = await renamePage(PAGE_A, "Renamed");
    const reordered = await reorderPages([{ id: PAGE_A, position: 3 }]);

    expect(created.ok).toBe(false);
    expect(renamed.success).toBe(false);
    expect(reordered.success).toBe(false);
    expect(taskWrites()).toEqual([]);
    expect(rpcCalls).not.toContain("ensure_task_type");
  });

  it("refuses sharing a section with the client", async () => {
    const { setSectionClientVisibility } = await import("@/lib/actions/architecture");

    const result = await setSectionClientVisibility(SECTION_A, true);

    expect(result.ok).toBe(false);
    expect(taskWrites()).toEqual([]);
  });

  it("still refuses a guest who was added to the project (team write role required)", async () => {
    projectMemberships.add(PROJECT_A);
    const { renameSection, setNodeMeta } = await import("@/lib/actions/architecture");

    expect((await renameSection(SECTION_A, "Renamed")).success).toBe(false);
    expect((await setNodeMeta(SECTION_A, { intent: "x" })).success).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("architecture writes: private projects", () => {
  it("refuses a plain member on a private project they are not a member of", async () => {
    const { renamePage, createComponent } = await import("@/lib/actions/architecture");

    expect((await renamePage(PAGE_PRIVATE, "Renamed")).success).toBe(false);
    expect((await createComponent(PROJECT_PRIVATE, "Hero")).success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("allows the same member once they are on the project", async () => {
    projectMemberships.add(PROJECT_PRIVATE);
    const { renamePage } = await import("@/lib/actions/architecture");

    expect((await renamePage(PAGE_PRIVATE, "Renamed")).success).toBe(true);
    expect(taskWrites()).toHaveLength(1);
  });

  it("rejects a batch reorder when any id belongs to a project the caller cannot see", async () => {
    const { reorderPages } = await import("@/lib/actions/architecture");

    const result = await reorderPages([
      { id: PAGE_A, position: 1 },
      { id: PAGE_PRIVATE, position: 2 },
    ]);

    expect(result.success).toBe(false);
    expect(taskWrites()).toEqual([]);
  });
});

describe("section client-visibility toggle", () => {
  it("refuses a subtask that is not an architecture section", async () => {
    const { setSectionClientVisibility } = await import("@/lib/actions/architecture");

    const result = await setSectionClientVisibility(PLAIN_SUBTASK, true);

    expect(result).toEqual({ ok: false, error: "Section not found." });
    expect(taskWrites()).toEqual([]);
  });

  it("shares a real section for a team member", async () => {
    const { setSectionClientVisibility } = await import("@/lib/actions/architecture");

    const result = await setSectionClientVisibility(SECTION_A, true);

    expect(result.ok).toBe(true);
    expect(taskWrites()).toHaveLength(1);
    expect(taskWrites()[0].payload).toEqual({ client_visible: true });
  });

  it("refuses moving a section onto a plain task or another project's page", async () => {
    const { moveSectionToPage } = await import("@/lib/actions/architecture");

    expect((await moveSectionToPage(SECTION_A, PLAIN_TASK, 1)).success).toBe(false);
    expect((await moveSectionToPage(SECTION_A, PAGE_PRIVATE, 1)).success).toBe(false);
    expect(taskWrites()).toEqual([]);
  });
});

describe("templates", () => {
  it("refuses saving a private project the member cannot see as a template", async () => {
    const { saveProjectAsTemplate } = await import("@/lib/actions/templates");

    const result = await saveProjectAsTemplate(PROJECT_PRIVATE, "Leak");

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(writes.filter((w) => w.table === "task_templates")).toEqual([]);
  });

  it("saves a private project the member can see, and audits it", async () => {
    projectMemberships.add(PROJECT_PRIVATE);
    const { saveProjectAsTemplate } = await import("@/lib/actions/templates");

    const result = await saveProjectAsTemplate(PROJECT_PRIVATE, "Allowed");

    expect(result.ok).toBe(true);
    expect(writes.filter((w) => w.table === "task_templates")).toHaveLength(1);
    expect(rpcCalls).toContain("write_audit_log_entry");
  });

  it("refuses a guest saving a task as a template, even on their own project", async () => {
    role = "guest";
    projectMemberships.add(PROJECT_A);
    const { saveTaskAsTemplate } = await import("@/lib/actions/templates");

    const result = await saveTaskAsTemplate(PLAIN_TASK, "Copy");

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses applying a template into a private project the caller cannot see", async () => {
    const { createTaskFromTemplate } = await import("@/lib/actions/templates");

    const result = await createTaskFromTemplate(TEMPLATE_ID, PROJECT_PRIVATE);

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(writes).toEqual([]);
  });

  it("audits deleting a template", async () => {
    const { deleteTemplate } = await import("@/lib/actions/templates");

    const result = await deleteTemplate(TEMPLATE_ID);

    expect(result.ok).toBe(true);
    expect(rpcCalls).toContain("write_audit_log_entry");
  });
});

describe("reorderProject", () => {
  it("returns and reorders only the projects the caller can see", async () => {
    const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    db.projects = [
      { ...project(PROJECT_A, "workspace"), sidebar_position: 0 },
      { ...project(PROJECT_PRIVATE, "private"), sidebar_position: 1 },
      { ...project(PROJECT_B, "workspace"), sidebar_position: 2 },
    ];
    const { reorderProject } = await import("@/lib/actions/projects");

    const result = await reorderProject(PROJECT_B, 0);

    expect(result).toEqual({ ok: true, data: { order: [PROJECT_B, PROJECT_A] } });
    const updated = writes.filter((w) => w.table === "projects");
    const updatedIds = updated.map(
      (w) => w.filters.find((f) => f.args[0] === "id")?.args[1],
    );
    expect(updatedIds).not.toContain(PROJECT_PRIVATE);
    for (const w of updated) {
      expect(w.filters).toContainEqual({ method: "eq", args: ["workspace_id", WORKSPACE_ID] });
    }
  });

  it("refuses a guest", async () => {
    role = "guest";
    const { reorderProject } = await import("@/lib/actions/projects");

    expect((await reorderProject(PROJECT_A, 0)).ok).toBe(false);
    expect(writes).toEqual([]);
  });
});
