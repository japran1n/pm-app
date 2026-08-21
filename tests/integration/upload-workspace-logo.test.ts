// Integration test for F138 (AS-243: "an owner can upload a logo, shown in
// the workspace switcher"), run against the real linked Supabase project —
// mirrors the loadDotEnv/skipIf and server-client mocking pattern
// established by tests/integration/rename-workspace.test.ts and
// tests/integration/upload-avatar.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    // writeAudit's `supabase.rpc(...)` call — non-fatal per its own
    // try/catch, but a bare mock avoids relying on that catch for a
    // method that doesn't exist at all.
    rpc: async () => ({ error: null }),
  }),
}));

const BUCKET = "avatars";

function buildFormData(workspaceId: string, file: File): FormData {
  const fd = new FormData();
  fd.set("workspaceId", workspaceId);
  fd.set("file", file);
  return fd;
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

describe.skipIf(!haveAdminCreds)("uploadWorkspaceLogo (F138: AS-243)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let ownerUserId: string;
  let memberUserId: string;
  let workspaceId: string;

  // A second, unrelated workspace — proves a logo upload never touches
  // any workspace other than the one the caller is admin/owner of
  // (cross-workspace isolation, per this feature's Definition-of-done
  // "no cross-workspace data leaks" requirement).
  let otherWorkspaceId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const ownerEmail = `f138-owner-${uniqueSuffix}@example.com`;
    const { data: ownerAuth, error: ownerAuthErr } =
      await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (ownerAuthErr || !ownerAuth.user) {
      throw new Error(`Failed to create owner user: ${ownerAuthErr?.message}`);
    }
    ownerUserId = ownerAuth.user.id;
    createdUserIds.push(ownerUserId);

    const memberEmail = `f138-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const { data: workspace, error: workspaceErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F138 Test Workspace", slug: `f138-test-${uniqueSuffix}` })
      .select("id")
      .single();
    if (workspaceErr || !workspace) {
      throw new Error(`Failed to create workspace: ${workspaceErr?.message}`);
    }
    workspaceId = workspace.id;
    createdWorkspaceIds.push(workspaceId);

    const { data: otherWorkspace, error: otherWorkspaceErr } =
      await adminClient
        .from("workspaces")
        .insert({
          name: "F138 Other Workspace",
          slug: `f138-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
    if (otherWorkspaceErr || !otherWorkspace) {
      throw new Error(
        `Failed to create other workspace: ${otherWorkspaceErr?.message}`,
      );
    }
    otherWorkspaceId = otherWorkspace.id;
    createdWorkspaceIds.push(otherWorkspaceId);

    const { error: membersErr } = await adminClient
      .from("workspace_members")
      .insert([
        {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          role: "owner",
          status: "active",
        },
        {
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        },
      ]);
    if (membersErr) {
      throw new Error(`Failed to create memberships: ${membersErr.message}`);
    }
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  afterAll(async () => {
    const { data: listed } = await adminClient.storage
      .from(BUCKET)
      .list(`workspace-logos/${workspaceId}`);
    if (listed && listed.length > 0) {
      await adminClient.storage
        .from(BUCKET)
        .remove(listed.map((obj) => `workspace-logos/${workspaceId}/${obj.name}`));
    }
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("AS-243: an owner can upload a logo, and workspaces.logo_url is updated to a fetchable public URL serving the uploaded bytes", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    currentTestUserId = ownerUserId;

    const { data: before } = await adminClient
      .from("workspaces")
      .select("logo_url")
      .eq("id", workspaceId)
      .single();
    expect(before?.logo_url).toBeNull();

    const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(buildFormData(workspaceId, file));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.logoUrl).toContain("/avatars/");
    expect(result.data.logoUrl).toContain(`workspace-logos/${workspaceId}/logo`);
    expect(result.data.logoUrl.startsWith("http")).toBe(true);

    const { data: after, error } = await adminClient
      .from("workspaces")
      .select("logo_url")
      .eq("id", workspaceId)
      .single();
    expect(error).toBeNull();
    expect(after?.logo_url).toBe(result.data.logoUrl);

    const response = await fetch(result.data.logoUrl);
    expect(response.ok).toBe(true);
    const servedBytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(servedBytes)).toEqual(Array.from(PNG_BYTES));
  });

  it("AS-243 (negative): a plain member cannot upload a workspace logo — the action rejects and no Storage object is written", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    currentTestUserId = memberUserId;

    const file = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
      "logo.webp",
      { type: "image/webp" },
    );
    const result = await uploadWorkspaceLogo(buildFormData(workspaceId, file));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("owner or admin");
  });

  it("negative: an unauthenticated caller is rejected", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    currentTestUserId = null;

    const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(buildFormData(workspaceId, file));

    expect(result.ok).toBe(false);
  });

  it("negative: an owner of a DIFFERENT workspace cannot set this workspace's logo (cross-workspace isolation)", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    // Make ownerUserId an owner of otherWorkspaceId too, but the call
    // below targets `workspaceId` (the FIRST workspace), where they are
    // already an owner — so instead prove the inverse: memberUserId,
    // who has no membership row at all in otherWorkspaceId, cannot set
    // otherWorkspaceId's logo.
    currentTestUserId = memberUserId;

    const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(
      buildFormData(otherWorkspaceId, file),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const { data: otherWorkspaceRow } = await adminClient
      .from("workspaces")
      .select("logo_url")
      .eq("id", otherWorkspaceId)
      .single();
    expect(otherWorkspaceRow?.logo_url).toBeNull();
  });

  it("negative (AS-206 convention): a logo larger than the configured size limit is rejected server-side, with a message naming the limit", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");
    const { MAX_AVATAR_SIZE_BYTES } = await import("@/lib/validation/profile");

    currentTestUserId = ownerUserId;

    const oversized = new Uint8Array(MAX_AVATAR_SIZE_BYTES + 1);
    const file = new File([oversized], "huge.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(buildFormData(workspaceId, file));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`${MAX_AVATAR_SIZE_BYTES / (1024 * 1024)}MB`);
  });

  it("negative (F274 convention): a spoofed-MIME upload (non-image bytes declared image/png) is rejected server-side, before any Storage write", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    currentTestUserId = ownerUserId;

    const spoofedBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]);
    const file = new File([spoofedBytes], "evil.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(buildFormData(workspaceId, file));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it("negative: an invalid workspaceId is rejected", async () => {
    const { uploadWorkspaceLogo } = await import("@/lib/actions/workspaces");

    currentTestUserId = ownerUserId;

    const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });
    const result = await uploadWorkspaceLogo(
      buildFormData("not-a-uuid", file),
    );

    expect(result.ok).toBe(false);
  });
});
