// Team-side task reads must not serve a portal client (the admin client
// they read through skips comments.internal / tasks.client_visible), and
// portal writes must be fully authorized before any Storage/DB write.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_A = "55555555-5555-4555-8555-555555555555";
const PROJECT_B = "66666666-6666-4666-8666-666666666666";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE_ID = "77777777-7777-4777-8777-777777777777";
const DOCUMENT_ID = "88888888-8888-4888-8888-888888888888";

type Op = { method: string; args: unknown[] };
type Query = { table: string; ops: Op[] };
type Result = { data: unknown; error: unknown };

let role: string;
let projectMemberships: Set<string>;
let resolveQuery: (q: Query) => Result;
let writes: string[];
let reads: Query[];

function filterValue(q: Query, column: string): unknown {
  const op = q.ops.find((o) => o.method === "eq" && o.args[0] === column);
  return op?.args[1];
}

function baseResolve(q: Query): Result | undefined {
  if (q.table === "workspace_members") {
    return { data: role ? { role } : null, error: null };
  }
  if (q.table === "project_members") {
    const projectId = filterValue(q, "project_id") as string;
    return {
      data: projectMemberships.has(projectId) ? { user_id: USER_ID } : null,
      error: null,
    };
  }
  return undefined;
}

function makeBuilder(table: string) {
  const q: Query = { table, ops: [] };
  const run = async (): Promise<Result> => {
    reads.push(q);
    return baseResolve(q) ?? resolveQuery(q);
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "ilike", "neq"]) {
    builder[method] = (...args: unknown[]) => {
      q.ops.push({ method, args });
      return builder;
    };
  }
  for (const method of ["insert", "update", "delete", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      writes.push(`${table}.${method}`);
      q.ops.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = run;
  builder.single = run;
  builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    run().then(resolve, reject);
  return builder;
}

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => makeBuilder(table),
    rpc: async (name: string) => {
      writes.push(`rpc.${name}`);
      return { data: [{ state: "delivered" }], error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async () => {
          writes.push(`storage.${bucket}.upload`);
          return { error: null };
        },
        remove: async () => {
          writes.push(`storage.${bucket}.remove`);
          return { error: null };
        },
        createSignedUrl: async (path: string) => {
          writes.push(`storage.${bucket}.sign:${path}`);
          return { data: { signedUrl: `https://signed/${path}` }, error: null };
        },
      }),
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
vi.mock("@/lib/notifications/portal-recipients", () => ({
  getPortalEventRecipients: async () => [],
}));
vi.mock("@/lib/notifications/create-notification", () => ({
  createNotification: async () => ({ ok: true }),
}));

beforeEach(() => {
  vi.resetModules();
  role = "member";
  projectMemberships = new Set();
  writes = [];
  reads = [];
  resolveQuery = () => ({ data: null, error: null });
});

function taskRow(projectId = PROJECT_A) {
  return {
    id: TASK_ID,
    title: "Internal task",
    project_id: projectId,
    parent_task_id: null,
    recurrence_parent_id: null,
    deleted_at: null,
    projects: { id: projectId, key: "AAA", workspace_id: WORKSPACE_ID, visibility: "workspace" },
  };
}

describe("getTaskDetail", () => {
  it("refuses a portal client before reading comments, subtasks or attachments", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "tasks" ? { data: taskRow(), error: null } : { data: [], error: null };

    const { getTaskDetail } = await import("@/lib/actions/tasks/queries");
    const result = await getTaskDetail(TASK_ID);

    expect(result).toEqual({ ok: false, error: "Task not found." });
    const tablesRead = new Set(reads.map((q) => q.table));
    expect(tablesRead.has("comments")).toBe(false);
    expect(tablesRead.has("attachments")).toBe(false);
    expect(tablesRead.has("task_dependencies")).toBe(false);
  });

  it("drops dependencies on tasks in projects a guest cannot see", async () => {
    role = "guest";
    projectMemberships.add(PROJECT_A);
    const related = (id: string, projectId: string, title: string) => ({
      id,
      title,
      status: "todo",
      number: 1,
      deleted_at: null,
      projects: { id: projectId, key: projectId === PROJECT_A ? "AAA" : "BBB", visibility: "workspace" },
    });
    resolveQuery = (q) => {
      if (q.table === "tasks") {
        return filterValue(q, "id") ? { data: taskRow(), error: null } : { data: [], error: null };
      }
      if (q.table === "task_dependencies") {
        const blockedBy = filterValue(q, "blocked_task_id");
        return {
          data: blockedBy
            ? [
                { id: "d1", blocking: related("t-visible", PROJECT_A, "Visible blocker") },
                { id: "d2", blocking: related("t-hidden", PROJECT_B, "Secret blocker") },
              ]
            : [{ id: "d3", blocked: related("t-hidden-2", PROJECT_B, "Secret blocked") }],
          error: null,
        };
      }
      return { data: [], error: null };
    };

    const { getTaskDetail } = await import("@/lib/actions/tasks/queries");
    const result = await getTaskDetail(TASK_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.task.dependencies?.blockedBy.map((d) => d.title)).toEqual([
      "Visible blocker",
    ]);
    expect(result.data.task.dependencies?.blocks).toEqual([]);
    expect(JSON.stringify(result.data)).not.toContain("Secret");
  });
});

describe("getOpenBlockers", () => {
  it("refuses a portal client", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "tasks"
        ? { data: taskRow(), error: null }
        : { data: [{ id: "d1", blocking: { id: "x", title: "Secret", deleted_at: null } }], error: null };

    const { getOpenBlockers } = await import("@/lib/actions/tasks/queries");
    const result = await getOpenBlockers(TASK_ID);

    expect(result).toEqual({ ok: false, error: "Task not found." });
    expect(reads.some((q) => q.table === "task_dependencies")).toBe(false);
  });

  it("redacts the title of an open blocker in a project the caller cannot see", async () => {
    role = "guest";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "tasks"
        ? { data: taskRow(), error: null }
        : {
            data: [
              {
                id: "d1",
                blocking: {
                  id: OTHER_TASK_ID,
                  title: "Secret blocker",
                  status: "todo",
                  number: 7,
                  deleted_at: null,
                  projects: { id: PROJECT_B, key: "BBB", visibility: "workspace" },
                  project_statuses: { category: "not_started" },
                },
              },
            ],
            error: null,
          };

    const { getOpenBlockers } = await import("@/lib/actions/tasks/queries");
    const result = await getOpenBlockers(TASK_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).not.toContain("Secret");
    expect(result.data[0].projectKey).toBeUndefined();
  });
});

describe("dependencies", () => {
  it("getDependencyCandidates refuses a portal client", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "tasks" ? { data: taskRow(), error: null } : { data: [], error: null };

    const { getDependencyCandidates } = await import("@/lib/actions/dependencies");
    const result = await getDependencyCandidates(TASK_ID, "blockedBy", "");

    expect(result).toEqual({ ok: false, error: "Task not found." });
    expect(reads.some((q) => q.table === "projects")).toBe(false);
  });

  it("createDependency refuses (and never inserts) when one task is in a project the caller cannot see", async () => {
    role = "guest";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) => {
      if (q.table === "tasks") {
        const id = filterValue(q, "id");
        return { data: id === TASK_ID ? taskRow(PROJECT_A) : { ...taskRow(PROJECT_B), id }, error: null };
      }
      return { data: null, error: null };
    };

    const { createDependency } = await import("@/lib/actions/dependencies");
    const result = await createDependency(TASK_ID, OTHER_TASK_ID);

    expect(result).toEqual({ ok: false, error: "Task not found." });
    expect(writes).toEqual([]);
  });
});

function deliverableRow(overrides: { project_id?: string; taskProjectId?: string } = {}) {
  const taskProjectId = overrides.taskProjectId ?? PROJECT_A;
  return {
    id: DELIVERABLE_ID,
    project_id: overrides.project_id ?? PROJECT_A,
    task_id: TASK_ID,
    state: "not_started",
    tasks: {
      id: TASK_ID,
      deleted_at: null,
      project_id: taskProjectId,
      projects: { workspace_id: WORKSPACE_ID, visibility: "workspace", portal_enabled: true },
    },
  };
}

async function deliver() {
  const formData = new FormData();
  formData.set("deliverableId", DELIVERABLE_ID);
  formData.set("file", new File(["hello"], "brief.pdf", { type: "application/pdf" }));
  const { deliverPortalDeliverable } = await import("@/lib/actions/portal-deliverables");
  return deliverPortalDeliverable(formData);
}

describe("deliverPortalDeliverable", () => {
  it("a viewer writes nothing", async () => {
    role = "viewer";
    resolveQuery = (q) =>
      q.table === "client_deliverables" ? { data: deliverableRow(), error: null } : { data: null, error: null };

    const result = await deliver();

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("a client writes nothing when the linked task belongs to another project", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "client_deliverables"
        ? { data: deliverableRow({ project_id: PROJECT_B, taskProjectId: PROJECT_A }), error: null }
        : { data: null, error: null };

    const result = await deliver();

    expect(result).toEqual({ ok: false, error: "Deliverable not found." });
    expect(writes).toEqual([]);
  });

  it("a client of another project writes nothing", async () => {
    role = "client";
    projectMemberships.add(PROJECT_B);
    resolveQuery = (q) =>
      q.table === "client_deliverables" ? { data: deliverableRow(), error: null } : { data: null, error: null };

    const result = await deliver();

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("a client of the project uploads, records the attachment, then marks delivered", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "client_deliverables" ? { data: deliverableRow(), error: null } : { data: null, error: null };

    const result = await deliver();

    expect(result.ok).toBe(true);
    expect(writes).toEqual([
      "storage.task-attachments.upload",
      "attachments.insert",
      "rpc.mark_deliverable_delivered_atomic",
    ]);
  });
});

function documentRow(filePath: string, projectId = PROJECT_A) {
  return {
    id: DOCUMENT_ID,
    kind: "upload",
    file_path: filePath,
    project_id: projectId,
    projects: { workspace_id: WORKSPACE_ID, visibility: "workspace", portal_enabled: true, deleted_at: null },
  };
}

describe("getScopeDocumentSignedUrl", () => {
  it("refuses a row whose file path points into another project", async () => {
    role = "member";
    resolveQuery = (q) =>
      q.table === "project_scope_documents"
        ? { data: documentRow(`${PROJECT_B}/contract.pdf`), error: null }
        : { data: null, error: null };

    const { getScopeDocumentSignedUrl } = await import("@/lib/actions/scope-documents");
    const result = await getScopeDocumentSignedUrl(DOCUMENT_ID);

    expect(result).toEqual({ ok: false, error: "Document not found." });
    expect(writes.some((w) => w.includes("sign"))).toBe(false);
  });

  it("refuses path traversal out of the project prefix", async () => {
    role = "member";
    resolveQuery = (q) =>
      q.table === "project_scope_documents"
        ? { data: documentRow(`${PROJECT_A}/../${PROJECT_B}/contract.pdf`), error: null }
        : { data: null, error: null };

    const { getScopeDocumentSignedUrl } = await import("@/lib/actions/scope-documents");
    const result = await getScopeDocumentSignedUrl(DOCUMENT_ID);

    expect(result.ok).toBe(false);
    expect(writes.some((w) => w.includes("sign"))).toBe(false);
  });

  it("refuses a client who is not a member of the document's project", async () => {
    role = "client";
    projectMemberships.add(PROJECT_B);
    resolveQuery = (q) =>
      q.table === "project_scope_documents"
        ? { data: documentRow(`${PROJECT_A}/contract.pdf`), error: null }
        : { data: null, error: null };

    const { getScopeDocumentSignedUrl } = await import("@/lib/actions/scope-documents");
    const result = await getScopeDocumentSignedUrl(DOCUMENT_ID);

    expect(result.ok).toBe(false);
    expect(writes.some((w) => w.includes("sign"))).toBe(false);
  });

  it("signs the project's own document for a client of that project", async () => {
    role = "client";
    projectMemberships.add(PROJECT_A);
    resolveQuery = (q) =>
      q.table === "project_scope_documents"
        ? { data: documentRow(`${PROJECT_A}/contract.pdf`), error: null }
        : { data: null, error: null };

    const { getScopeDocumentSignedUrl } = await import("@/lib/actions/scope-documents");
    const result = await getScopeDocumentSignedUrl(DOCUMENT_ID);

    expect(result.ok).toBe(true);
    expect(writes).toEqual([`storage.scope-documents.sign:${PROJECT_A}/contract.pdf`]);
  });
});
