// Security audit 2026-09-24: the board-parity "flat" sitemap actions
// (lib/actions/sitemaps.ts) used to authorize only `updates[0]` (or only
// the section, never the component / target sitemap) and then write every
// caller-chosen id through the service-role client -- a cross-workspace
// write. These tests pin the fix: every id in a batch must resolve to ONE
// live sitemap the caller may write, or nothing is written.
//
// The admin client is a minimal in-memory chainable stub (same "mock
// supabase, no network" convention as the other lib/actions tests); it
// records every write so a refused batch can be asserted to have written
// nothing at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WS_MINE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITEMAP_A = "a0000000-0000-4000-8000-000000000001"; // mine
const SITEMAP_A2 = "a0000000-0000-4000-8000-000000000002"; // mine, second sitemap
const SITEMAP_B = "b0000000-0000-4000-8000-000000000001"; // other workspace
const SITEMAP_ARCHIVED = "a0000000-0000-4000-8000-000000000003";

const PAGE_A1 = "c0000000-0000-4000-8000-00000000a001";
const PAGE_A2 = "c0000000-0000-4000-8000-00000000a002";
const PAGE_A2_OTHER_SITEMAP = "c0000000-0000-4000-8000-00000000a201";
const PAGE_B1 = "c0000000-0000-4000-8000-00000000b001";
const PAGE_ARCHIVED = "c0000000-0000-4000-8000-00000000c001";

const SECTION_A1 = "d0000000-0000-4000-8000-00000000a001";
const SECTION_A2 = "d0000000-0000-4000-8000-00000000a002";
const SECTION_B1 = "d0000000-0000-4000-8000-00000000b001";

const COMPONENT_A = "e0000000-0000-4000-8000-00000000a001";
const COMPONENT_B = "e0000000-0000-4000-8000-00000000b001";

type Row = Record<string, unknown>;

const sitemaps: Record<string, Row> = {
  [SITEMAP_A]: { id: SITEMAP_A, workspace_id: WS_MINE, archived_at: null },
  [SITEMAP_A2]: { id: SITEMAP_A2, workspace_id: WS_MINE, archived_at: null },
  [SITEMAP_B]: { id: SITEMAP_B, workspace_id: WS_OTHER, archived_at: null },
  [SITEMAP_ARCHIVED]: {
    id: SITEMAP_ARCHIVED,
    workspace_id: WS_MINE,
    archived_at: "2026-09-01T00:00:00Z",
  },
};

function page(id: string, sitemapId: string): Row {
  return { id, sitemap_id: sitemapId, sitemaps: sitemaps[sitemapId] };
}

const pages: Row[] = [
  page(PAGE_A1, SITEMAP_A),
  page(PAGE_A2, SITEMAP_A),
  page(PAGE_A2_OTHER_SITEMAP, SITEMAP_A2),
  page(PAGE_B1, SITEMAP_B),
  page(PAGE_ARCHIVED, SITEMAP_ARCHIVED),
];

function section(id: string, pageId: string): Row {
  const p = pages.find((row) => row.id === pageId)!;
  return { id, page_id: pageId, title: "Hero", component_id: null, sitemap_pages: p };
}

const sections: Row[] = [
  section(SECTION_A1, PAGE_A1),
  section(SECTION_A2, PAGE_A2),
  section(SECTION_B1, PAGE_B1),
];

const components: Row[] = [
  { id: COMPONENT_A, sitemap_id: SITEMAP_A, sitemaps: sitemaps[SITEMAP_A] },
  { id: COMPONENT_B, sitemap_id: SITEMAP_B, sitemaps: sitemaps[SITEMAP_B] },
];

const tables: Record<string, Row[]> = {
  sitemap_pages: pages,
  sitemap_sections: sections,
  sitemap_components: components,
  sitemaps: Object.values(sitemaps),
};

type Write = { table: string; op: "update" | "insert"; payload: unknown; filters: unknown[] };
let writes: Write[] = [];
let roles: Record<string, string> = {};

function builder(table: string) {
  let op: "select" | "update" | "insert" = "select";
  let payload: unknown = null;
  let single = false;
  let head = false;
  const filters: [string, string, unknown][] = [];

  const resolve = () => {
    if (op === "update" || op === "insert") {
      writes.push({ table, op, payload, filters: [...filters] });
      return { data: op === "insert" ? { id: "new-id" } : null, error: null };
    }
    const rows = (tables[table] ?? []).filter((row) =>
      filters.every(([kind, col, value]) => {
        if (kind === "eq") return row[col] === value;
        if (kind === "in") return (value as unknown[]).includes(row[col]);
        if (kind === "is") return (row[col] ?? null) === value;
        return true;
      }),
    );
    if (head) return { count: rows.length, error: null };
    if (single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };

  const chain = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true;
      return chain;
    },
    update: (value: unknown) => {
      op = "update";
      payload = value;
      return chain;
    },
    insert: (value: unknown) => {
      op = "insert";
      payload = value;
      return chain;
    },
    eq: (col: string, value: unknown) => {
      filters.push(["eq", col, value]);
      return chain;
    },
    in: (col: string, value: unknown[]) => {
      filters.push(["in", col, value]);
      return chain;
    },
    is: (col: string, value: unknown) => {
      filters.push(["is", col, value]);
      return chain;
    },
    maybeSingle: () => {
      single = true;
      return Promise.resolve(resolve());
    },
    single: () => {
      single = true;
      return Promise.resolve(resolve());
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ user: { id: USER_ID } }),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async (_admin: unknown, workspaceId: string) => {
    const role = roles[workspaceId];
    return role ? { ok: true, role } : { ok: false };
  },
}));

const actions = await import("@/lib/actions/sitemaps");

beforeEach(() => {
  writes = [];
  // Caller writes in WS_MINE only; WS_OTHER is someone else's workspace.
  roles = { [WS_MINE]: "member" };
  for (const s of sections) s.component_id = null;
});

describe("reorderSitemapPagesFlat", () => {
  it("refuses a batch whose later id belongs to another workspace, writing nothing", async () => {
    const result = await actions.reorderSitemapPagesFlat([
      { id: PAGE_A1, position: 0 },
      { id: PAGE_B1, position: 1 },
    ]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a batch mixing two sitemaps of the caller's own workspace", async () => {
    const result = await actions.reorderSitemapPagesFlat([
      { id: PAGE_A1, position: 0 },
      { id: PAGE_A2_OTHER_SITEMAP, position: 1 },
    ]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a batch naming an unknown id", async () => {
    const result = await actions.reorderSitemapPagesFlat([
      { id: PAGE_A1, position: 0 },
      { id: "c0000000-0000-4000-8000-0000000000ff", position: 1 },
    ]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses pages of an archived sitemap", async () => {
    const result = await actions.reorderSitemapPagesFlat([{ id: PAGE_ARCHIVED, position: 0 }]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses malformed positions", async () => {
    const result = await actions.reorderSitemapPagesFlat([
      { id: PAGE_A1, position: -1 },
      { id: PAGE_A2, position: 1.5 },
    ]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a caller without team write access (guest)", async () => {
    roles = { [WS_MINE]: "guest" };
    const result = await actions.reorderSitemapPagesFlat([{ id: PAGE_A1, position: 0 }]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("writes every page of a single writable sitemap, scoped to that sitemap", async () => {
    const result = await actions.reorderSitemapPagesFlat([
      { id: PAGE_A2, position: 0 },
      { id: PAGE_A1, position: 1 },
    ]);
    expect(result.success).toBe(true);
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.table).toBe("sitemap_pages");
      expect(write.filters).toContainEqual(["eq", "sitemap_id", SITEMAP_A]);
    }
  });
});

describe("reorderSitemapSectionsFlat", () => {
  it("refuses a batch whose later id belongs to another workspace, writing nothing", async () => {
    const result = await actions.reorderSitemapSectionsFlat([
      { id: SECTION_A1, position: 0 },
      { id: SECTION_B1, position: 1 },
    ]);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("writes sections that all belong to one writable sitemap", async () => {
    const result = await actions.reorderSitemapSectionsFlat([
      { id: SECTION_A1, position: 1 },
      { id: SECTION_A2, position: 0 },
    ]);
    expect(result.success).toBe(true);
    expect(writes.map((w) => w.table)).toEqual(["sitemap_sections", "sitemap_sections"]);
  });
});

describe("moveSitemapSectionToPage", () => {
  it("refuses a target page in a different sitemap", async () => {
    const result = await actions.moveSitemapSectionToPage(SECTION_A1, PAGE_A2_OTHER_SITEMAP, 0);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a target page in another workspace", async () => {
    const result = await actions.moveSitemapSectionToPage(SECTION_A1, PAGE_B1, 0);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("linkSitemapComponentToSection", () => {
  it("refuses a component from another workspace's sitemap", async () => {
    const result = await actions.linkSitemapComponentToSection(SECTION_A1, COMPONENT_B);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("links a component of the section's own sitemap", async () => {
    const result = await actions.linkSitemapComponentToSection(SECTION_A1, COMPONENT_A);
    expect(result.success).toBe(true);
    expect(writes).toEqual([
      {
        table: "sitemap_sections",
        op: "update",
        payload: { component_id: COMPONENT_A },
        filters: [["eq", "id", SECTION_A1]],
      },
    ]);
  });
});

describe("createSitemapComponentFromSection", () => {
  it("refuses a caller-chosen sitemap that is not the section's own", async () => {
    const result = await actions.createSitemapComponentFromSection(SECTION_A1, SITEMAP_B);
    expect(result.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it("creates the component in the section's own sitemap", async () => {
    const result = await actions.createSitemapComponentFromSection(SECTION_A1, SITEMAP_A);
    expect(result.success).toBe(true);
    const insert = writes.find((w) => w.op === "insert");
    expect(insert?.table).toBe("sitemap_components");
    expect((insert?.payload as { sitemap_id: string }).sitemap_id).toBe(SITEMAP_A);
  });
});
