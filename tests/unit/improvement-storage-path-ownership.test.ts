// restoreImprovement receives before/after paths back from the client; it
// must refuse any path outside this project's improvements folder, and the
// signed-URL read must never sign a stored path outside it either.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const IMPROVEMENT_ID = "77777777-7777-4777-8777-777777777777";

type Op = { method: string; args: unknown[] };
type Query = { table: string; ops: Op[] };
type Result = { data: unknown; error: unknown };

let writes: Query[];
let storageCalls: string[];
let improvementRow: Record<string, unknown> | null;

function resolve(q: Query): Result {
  if (q.table === "workspace_members") return { data: { role: "member" }, error: null };
  if (q.table === "projects") {
    return {
      data: {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        visibility: "workspace",
        deleted_at: null,
        baseline_frozen_at: null,
        workspaces: { slug: "acme" },
      },
      error: null,
    };
  }
  if (q.table === "project_improvements") {
    const insert = q.ops.find((op) => op.method === "insert");
    if (insert) return { data: insert.args[0], error: null };
    return { data: improvementRow, error: null };
  }
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
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          storageCalls.push(`sign:${bucket}:${path}`);
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

beforeEach(() => {
  vi.resetModules();
  writes = [];
  storageCalls = [];
  improvementRow = null;
});

function restoreInput(paths: { beforePath: string | null; afterPath: string | null }) {
  return {
    projectId: PROJECT_ID,
    id: IMPROVEMENT_ID,
    area: "Speed",
    explanation: "Faster",
    position: 1,
    clientVisible: true,
    ...paths,
  };
}

function improvementInserts() {
  return writes.filter((q) => q.table === "project_improvements");
}

describe("restoreImprovement", () => {
  it.each([
    ["another project's folder", `improvements/${OTHER_PROJECT_ID}/a.png`],
    ["a task attachment path", "11111111-1111-4111-8111-111111111111/secret.pdf"],
    ["a traversal path", `improvements/${PROJECT_ID}/../${OTHER_PROJECT_ID}/a.png`],
  ])("refuses %s without writing", async (_label, foreignPath) => {
    const { restoreImprovement } = await import("@/lib/actions/metrics");

    const before = await restoreImprovement(restoreInput({ beforePath: foreignPath, afterPath: null }));
    const after = await restoreImprovement(
      restoreInput({ beforePath: `improvements/${PROJECT_ID}/ok.png`, afterPath: foreignPath }),
    );

    expect(before.ok).toBe(false);
    expect(after.ok).toBe(false);
    expect(improvementInserts()).toEqual([]);
  });

  it("restores paths inside this project's improvements folder", async () => {
    const { restoreImprovement } = await import("@/lib/actions/metrics");

    const result = await restoreImprovement(
      restoreInput({ beforePath: `improvements/${PROJECT_ID}/b.png`, afterPath: null }),
    );

    expect(result.ok).toBe(true);
    const inserted = improvementInserts()[0]?.ops.find((op) => op.method === "insert")?.args[0] as
      | Record<string, unknown>
      | undefined;
    expect(inserted?.before_path).toBe(`improvements/${PROJECT_ID}/b.png`);
    expect(inserted?.project_id).toBe(PROJECT_ID);
  });
});

describe("getImprovementImageSignedUrl", () => {
  function row(beforePath: string) {
    return {
      id: IMPROVEMENT_ID,
      project_id: PROJECT_ID,
      before_path: beforePath,
      after_path: null,
      client_visible: true,
      projects: { workspace_id: WORKSPACE_ID, visibility: "workspace", portal_enabled: true, deleted_at: null },
    };
  }

  it("does not sign a stored path outside the project's folder", async () => {
    improvementRow = row(`improvements/${OTHER_PROJECT_ID}/a.png`);
    const { getImprovementImageSignedUrl } = await import("@/lib/actions/metrics");

    const result = await getImprovementImageSignedUrl(IMPROVEMENT_ID, "before");

    expect(result).toEqual({ ok: false, error: "Image not found." });
    expect(storageCalls).toEqual([]);
  });

  it("signs an owned path", async () => {
    improvementRow = row(`improvements/${PROJECT_ID}/a.png`);
    const { getImprovementImageSignedUrl } = await import("@/lib/actions/metrics");

    const result = await getImprovementImageSignedUrl(IMPROVEMENT_ID, "before");

    expect(result.ok).toBe(true);
    expect(storageCalls).toEqual([`sign:task-attachments:improvements/${PROJECT_ID}/a.png`]);
  });
});
