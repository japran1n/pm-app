// The 'Undo' restore actions re-insert a client-held snapshot. Actor,
// timestamp and client-review columns must never be taken from that
// snapshot: they are forced server-side.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "33333333-3333-4333-8333-333333333333";
const FORGED_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const ROW_ID = "77777777-7777-4777-8777-777777777777";
const METRIC_ID = "88888888-8888-4888-8888-888888888888";

type Op = { method: string; args: unknown[] };
type Query = { table: string; ops: Op[] };
type Result = { data: unknown; error: unknown };

let writes: Query[];

const projectRow = {
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  visibility: "workspace",
  deleted_at: null,
  baseline_frozen_at: null,
  workspaces: { slug: "acme" },
};

function resolve(q: Query): Result {
  if (q.table === "workspace_members") return { data: { role: "member" }, error: null };
  if (q.table === "projects") return { data: projectRow, error: null };
  if (q.table === "project_metrics") {
    return { data: { id: METRIC_ID, project_id: PROJECT_ID, name: "m", projects: projectRow }, error: null };
  }
  const insert = q.ops.find((op) => op.method === "insert");
  if (insert) return { data: insert.args[0], error: null };
  return { data: null, error: null };
}

function makeBuilder(table: string) {
  const q: Query = { table, ops: [] };
  const run = async () => resolve(q);
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "neq"]) {
    builder[method] = (...args: unknown[]) => {
      q.ops.push({ method, args });
      return builder;
    };
  }
  for (const method of ["insert", "update", "delete", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      q.ops.push({ method, args });
      writes.push(q);
      return builder;
    };
  }
  builder.maybeSingle = run;
  builder.single = run;
  builder.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail);
  return builder;
}

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => makeBuilder(table),
    rpc: async () => ({ data: null, error: null }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
  isPortalPreview: async () => false,
  PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE: "preview",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  vi.resetModules();
  writes = [];
});

function insertPayload(table: string): Record<string, unknown> {
  const q = writes.find((w) => w.table === table && w.ops.some((o) => o.method === "insert"));
  expect(q, `no insert into ${table}`).toBeTruthy();
  return q!.ops.find((o) => o.method === "insert")!.args[0] as Record<string, unknown>;
}

describe("restore actions force server-side columns", () => {
  it("restoreDecision uses the caller as created_by", async () => {
    const { restoreDecision } = await import("@/lib/actions/project-records");
    await restoreDecision({
      projectId: PROJECT_ID,
      id: ROW_ID,
      phaseId: null,
      title: "t",
      rationale: null,
      decisionType: "content",
      decidedOn: "2026-01-01",
      decidedByName: null,
      clientVisible: true,
      createdBy: FORGED_ID,
    });
    expect(insertPayload("project_decisions").created_by).toBe(USER_ID);
  });

  it("restoreAssumption never carries client-flag fields", async () => {
    const { restoreAssumption } = await import("@/lib/actions/project-records");
    await restoreAssumption({
      projectId: PROJECT_ID,
      id: ROW_ID,
      text: "a",
      state: "assumed",
      confirmedOn: null,
      confirmedByName: null,
      clientVisible: true,
      flaggedByClientAt: "2026-01-01T00:00:00Z",
      flaggedNote: "forged",
    });
    const payload = insertPayload("project_assumptions");
    expect(payload.flagged_by_client_at).toBeNull();
    expect(payload.flagged_note).toBeNull();
  });

  it("restoreSnapshot uses the caller and omits created_at", async () => {
    const { restoreSnapshot } = await import("@/lib/actions/metrics");
    await restoreSnapshot({
      metricId: METRIC_ID,
      id: ROW_ID,
      value: 1,
      measuredAt: "2026-01-01",
      note: null,
      createdBy: FORGED_ID,
      createdAt: "2001-01-01T00:00:00Z",
    });
    const payload = insertPayload("metric_snapshots");
    expect(payload.created_by).toBe(USER_ID);
    expect("created_at" in payload).toBe(false);
  });

  it("restoreDeliverable drops acceptance actor/timestamp and downgrades accepted", async () => {
    const { restoreDeliverable } = await import("@/lib/actions/deliverables");
    await restoreDeliverable({
      projectId: PROJECT_ID,
      id: ROW_ID,
      phaseId: null,
      taskId: null,
      title: "d",
      description: null,
      kind: "copy",
      ownerName: "me",
      dueAt: null,
      blocking: false,
      state: "accepted",
      deliveredAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-02T00:00:00Z",
      acceptedBy: FORGED_ID,
      reviewNote: null,
      position: 1,
    } as never);
    const payload = insertPayload("client_deliverables");
    expect(payload.accepted_by).toBeNull();
    expect(payload.accepted_at).toBeNull();
    expect(payload.state).toBe("delivered");
  });
});
