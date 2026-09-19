// @vitest-environment jsdom
// Mission 20260919-150607, F092 (AS-095, AS-096): round-trip coverage for
// `copy_status` and `keywords` through the real `setNodeMeta` action and
// `getArchitectureNodeDetails` query, on a section task id. F027's test file
// (f027-copy-status-keywords-limit.test.ts) only exercised `safeParse`
// against `setNodeMetaSchema` -- it never called the real action, so the
// action's independent post-dedupe `.slice(0, 30)` in
// lib/actions/architecture/node-meta.ts:120-129, and the upsert's
// `copy_status` field at :149-151, were never reached by any test. These
// tests fake the Supabase client exactly as tests/unit/
// f026-meta-bound-to-section.test.ts does, and drive the real action + real
// query end to end.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/actions/portal-revalidate", () => ({
  revalidatePortalProject: vi.fn(),
  extractWorkspaceSlug: vi.fn((workspaces: unknown) => {
    if (Array.isArray(workspaces)) return workspaces[0]?.slug;
    return (workspaces as { slug?: string } | null)?.slug;
  }),
}));

const getUser = vi.fn(async () => ({ user: { id: "user-1" } }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => getUser()),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "owner" })),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: vi.fn(() => true),
}));

const PAGE_TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTION_TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

// In-memory store standing in for the architecture_node_meta table, keyed
// by task_id -- mirrors the real table's PK / upsert(onConflict: "task_id").
let metaByTaskId: Map<string, Row>;

function taskRowFor(taskId: string): Row {
  return {
    id: taskId,
    project_id: PROJECT_ID,
    parent_task_id: taskId === SECTION_TASK_ID ? PAGE_TASK_ID : null,
    projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
  };
}

function buildAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, taskId: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: taskRowFor(taskId), error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "architecture_node_meta") {
        return {
          upsert: vi.fn((payload: Row, _opts: { onConflict: string }) => {
            metaByTaskId.set(payload.task_id as string, {
              ...(metaByTaskId.get(payload.task_id as string) ?? {}),
              ...payload,
            });
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildAdminMock()),
}));

function buildFilterableQuery(rows: Row[]) {
  const query: Record<string, unknown> = {
    eq: vi.fn((column: string, value: unknown) =>
      buildFilterableQuery(rows.filter((row) => row[column] === value)),
    ),
    not: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  (query as unknown as PromiseLike<unknown>).then = ((
    onfulfilled?: ((value: unknown) => unknown) | null,
  ) =>
    Promise.resolve(
      onfulfilled ? onfulfilled({ data: rows, error: null }) : { data: rows, error: null },
    )) as PromiseLike<unknown>["then"];
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "task_discipline_estimates") {
        return { select: vi.fn(() => buildFilterableQuery([])) };
      }
      if (table === "architecture_node_meta") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async (_col: string, projectId: string) => ({
              data: [...metaByTaskId.values()].filter((row) => row.project_id === projectId),
              error: null,
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { setNodeMeta } from "@/lib/actions/architecture";
import { getArchitectureNodeDetails } from "@/lib/queries/architecture-details";

beforeEach(() => {
  metaByTaskId = new Map();
  getUser.mockImplementation(async () => ({ user: { id: "user-1" } }));
});

function makeKeywords(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `keyword-${i}`);
}

describe("F092 / AS-095: copy_status round-trips through setNodeMeta + getArchitectureNodeDetails", () => {
  const copyStatuses = [
    "not_started",
    "brief_ready",
    "drafted",
    "in_review",
    "approved",
  ] as const;

  it.each(copyStatuses)(
    "test_AS_095_copy_status_%s_round_trips_via_real_setNodeMeta_and_getArchitectureNodeDetails",
    async (status) => {
      const result = await setNodeMeta(SECTION_TASK_ID, { copyStatus: status });
      expect(result.success).toBe(true);

      const details = await getArchitectureNodeDetails(PROJECT_ID);
      expect(details.ok).toBe(true);
      if (!details.ok) return;

      const sectionDetails = details.data.get(SECTION_TASK_ID);
      expect(sectionDetails?.meta?.copyStatus).toBe(status);
    },
  );
});

describe("F092 / AS-096: keyword limit round-trips through setNodeMeta + getArchitectureNodeDetails", () => {
  // Note: `setNodeMetaSchema` (lib/validation/architecture.ts) already
  // enforces `.max(30)` on the raw `keywords` array, and the DB carries a
  // matching `architecture_node_meta_keywords_bounded` CHECK constraint.
  // So a raw submission of 35 keywords never reaches the action's
  // post-dedupe `.slice(0, 30)` (lib/actions/architecture/node-meta.ts) at
  // all -- it is rejected at the schema boundary before the action's DB
  // call. This test exercises that real, user-facing outcome: nothing
  // beyond 30 keywords is ever accepted or stored, end to end.
  it("test_AS_096_submitting_35_keywords_is_rejected_and_nothing_is_stored", async () => {
    const result = await setNodeMeta(SECTION_TASK_ID, { keywords: makeKeywords(35) });
    expect(result.success).toBe(false);

    const details = await getArchitectureNodeDetails(PROJECT_ID);
    expect(details.ok).toBe(true);
    if (!details.ok) return;

    const sectionDetails = details.data.get(SECTION_TASK_ID);
    expect(sectionDetails).toBeUndefined();
  });

  // Duplicates (case/whitespace variants) collapse via the action's
  // dedupe step *before* the `.slice(0, 30)` runs, so a raw array of 30
  // entries containing duplicates still results in fewer than 30 stored
  // keywords -- this is the one path where the dedupe+slice pairing in the
  // action (as opposed to the schema's raw-length check) is the only thing
  // enforcing the final count.
  it("test_AS_096_submitting_30_keywords_with_case_duplicates_dedupes_via_the_real_action", async () => {
    const raw = [...makeKeywords(29), "KEYWORD-0"]; // 30 raw entries, "keyword-0" duplicated by case
    const result = await setNodeMeta(SECTION_TASK_ID, { keywords: raw });
    expect(result.success).toBe(true);

    const details = await getArchitectureNodeDetails(PROJECT_ID);
    expect(details.ok).toBe(true);
    if (!details.ok) return;

    const sectionDetails = details.data.get(SECTION_TASK_ID);
    expect(sectionDetails?.meta?.keywords).toHaveLength(29);
  });

  it("test_AS_096_submitting_30_distinct_keywords_stores_all_30_after_real_action_round_trip", async () => {
    const result = await setNodeMeta(SECTION_TASK_ID, { keywords: makeKeywords(30) });
    expect(result.success).toBe(true);

    const details = await getArchitectureNodeDetails(PROJECT_ID);
    expect(details.ok).toBe(true);
    if (!details.ok) return;

    const sectionDetails = details.data.get(SECTION_TASK_ID);
    expect(sectionDetails?.meta?.keywords).toHaveLength(30);
    expect(sectionDetails?.meta?.keywords).toEqual(makeKeywords(30));
  });
});
