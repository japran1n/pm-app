// SEC-ACT3-07: lib/actions/docs.ts authorizes every write at the app layer
// (active membership + team-writer role + project visibility) and treats a
// zero-row UPDATE/DELETE as a failure instead of success.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const WS = "00000000-0000-4000-8000-0000000000aa";
const OTHER_WS = "00000000-0000-4000-8000-0000000000bb";
const PROJECT = "00000000-0000-4000-8000-0000000000cc";
const DOC = "00000000-0000-4000-8000-0000000000d1";
const LINK = "00000000-0000-4000-8000-0000000000e1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const USER = "00000000-0000-4000-8000-000000000099";

let role: string | null = "member";
let visible = true;
let adminRows: Record<string, unknown> = {};
let sessionAffected: unknown[] = [{ id: DOC }];
const sessionInsert = vi.fn();
const writeAudit = vi.fn(async () => {});

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () =>
    role ? { ok: true, role } : { ok: false },
  ),
}));
vi.mock("@/lib/actions/project-visibility", () => ({
  isProjectVisibleToCaller: vi.fn(async () => visible),
}));
vi.mock("@/lib/activity/audit", () => ({ writeAudit }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: adminRows[table] ?? null, error: null })),
      };
      return chain;
    }),
  })),
}));

function sessionClient() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    insert: vi.fn((row: unknown) => {
      sessionInsert(row);
      return chain;
    }),
    single: vi.fn(async () => ({ data: { id: "new-id" }, error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: sessionAffected, error: null }),
  });
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER } } })) },
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ error: null })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => sessionClient()),
}));

beforeEach(() => {
  role = "member";
  visible = true;
  sessionAffected = [{ id: DOC }];
  sessionInsert.mockClear();
  writeAudit.mockClear();
  adminRows = {
    docs: { workspace_id: WS, project_id: PROJECT },
    projects: { workspace_id: WS, visibility: "workspace" },
    doc_links: { doc_id: DOC },
    doc_folders: { workspace_id: WS, project_id: PROJECT },
  };
});

const link = {
  docId: DOC,
  url: "https://example.com/video",
  title: "Walkthrough",
};

describe("docs actions authz (SEC-ACT3-07)", () => {
  it("a viewer cannot add a portal-visible doc link", async () => {
    role = "viewer";
    const { addDocLink } = await import("@/lib/actions/docs");
    const result = await addDocLink(link);
    expect(result.ok).toBe(false);
    expect(sessionInsert).not.toHaveBeenCalled();
  });

  it.each(["guest", "client"])("a %s cannot write docs", async (r) => {
    role = r;
    const { updateDoc, createDoc } = await import("@/lib/actions/docs");
    expect((await updateDoc(DOC, "T", "c")).error).toBeTruthy();
    expect("error" in (await createDoc(WS, null, PROJECT))).toBe(true);
    expect(sessionInsert).not.toHaveBeenCalled();
  });

  it("a non-member gets not-found", async () => {
    role = null;
    const { deleteDoc } = await import("@/lib/actions/docs");
    expect((await deleteDoc(DOC)).error).toBe("Document not found.");
  });

  it("a member who cannot see the private project gets not-found", async () => {
    visible = false;
    const { setDocKind } = await import("@/lib/actions/docs");
    const result = await setDocKind(DOC, "note");
    expect(result).toEqual({ ok: false, error: "Document not found." });
  });

  it("a member can add a link", async () => {
    const { addDocLink } = await import("@/lib/actions/docs");
    const result = await addDocLink(link);
    expect(result.ok).toBe(true);
    expect(sessionInsert).toHaveBeenCalledOnce();
  });

  it("an update RLS filtered to zero rows is an error, not success (ORG-MOD-07)", async () => {
    sessionAffected = [];
    const { updateDoc, deleteDoc, moveDoc, renameDocFolder, deleteDocLink } =
      await import("@/lib/actions/docs");
    expect((await updateDoc(DOC, "T", "c")).error).toBeTruthy();
    expect((await deleteDoc(DOC)).error).toBeTruthy();
    expect((await moveDoc(DOC, null)).error).toBeTruthy();
    expect((await renameDocFolder(FOLDER, "x")).error).toBeTruthy();
    expect((await deleteDocLink(LINK)).ok).toBe(false);
  });

  it("with the concurrency guard, zero rows is still a conflict", async () => {
    sessionAffected = [];
    const { updateDoc } = await import("@/lib/actions/docs");
    expect(await updateDoc(DOC, "T", "c", "2026-01-01T00:00:00Z")).toEqual({ conflict: true });
  });

  it("a doc cannot be moved into a folder from another workspace", async () => {
    adminRows.doc_folders = { workspace_id: OTHER_WS, project_id: PROJECT };
    const { moveDoc } = await import("@/lib/actions/docs");
    expect((await moveDoc(DOC, FOLDER)).error).toBe("Folder not found.");
  });

  it("sharing a doc with the client is audited", async () => {
    const { setDocClientVisibility } = await import("@/lib/actions/docs");
    const result = await setDocClientVisibility(DOC, true);
    expect(result.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "doc.client_shared", targetId: DOC }),
    );
  });
});
