// Integration test for F123 `updateProfile` (AS-202), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/createClient-mock
// pattern established by tests/integration/upload-avatar.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { vi } from "vitest";
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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "updateProfile (F123: AS-202)",
  () => {
    let adminClient: SupabaseClient;
    const createdUserIds: string[] = [];

    let userAId: string;
    let userAEmail: string;
    let userBId: string;
    let userBEmail: string;
    let userCId: string;
    let userCEmail: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // User A: the caller who saves a display name (AS-202 positive
      // case).
      userAEmail = `f123-user-a-${uniqueSuffix}@example.com`;
      const { data: authA, error: authAErr } =
        await adminClient.auth.admin.createUser({
          email: userAEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authAErr || !authA.user) {
        throw new Error(`Failed to create user A: ${authAErr?.message}`);
      }
      userAId = authA.user.id;
      createdUserIds.push(userAId);

      // User B: a bystander with a pre-existing display name, used to
      // prove user A's call never touches anyone else's row.
      userBEmail = `f123-user-b-${uniqueSuffix}@example.com`;
      const { data: authB, error: authBErr } =
        await adminClient.auth.admin.createUser({
          email: userBEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authBErr || !authB.user) {
        throw new Error(`Failed to create user B: ${authBErr?.message}`);
      }
      userBId = authB.user.id;
      createdUserIds.push(userBId);

      const { error: seedBErr } = await adminClient
        .from("profiles")
        .update({ display_name: "Original B Name" })
        .eq("id", userBId);
      if (seedBErr) {
        throw new Error(`Failed to seed user B's profile: ${seedBErr.message}`);
      }

      // User C: never sets a display name — used to verify the resolver's
      // fallback chain (display_name -> email local part -> email) picks
      // the local part, not the raw address.
      userCEmail = `f123-user-c-${uniqueSuffix}@example.com`;
      const { data: authC, error: authCErr } =
        await adminClient.auth.admin.createUser({
          email: userCEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authCErr || !authC.user) {
        throw new Error(`Failed to create user C: ${authCErr?.message}`);
      }
      userCId = authC.user.id;
      createdUserIds.push(userCId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const userId of createdUserIds) {
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-202: a user can set their display name, and it persists on their own profiles row", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");

      currentTestUserId = userAId;

      const result = await updateProfile("Jane Doe", "America/New_York");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.displayName).toBe("Jane Doe");
      expect(result.data.timezone).toBe("America/New_York");

      const { data: after, error } = await adminClient
        .from("profiles")
        .select("display_name, timezone")
        .eq("id", userAId)
        .single();
      expect(error).toBeNull();
      expect(after?.display_name).toBe("Jane Doe");
      expect(after?.timezone).toBe("America/New_York");
    });

    it("AS-202: the saved display name is what the shared person-resolver returns for that user (the same resolver every task card/comment/member list/picker renders through), instead of their email", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");
      const { resolvePeople } = await import("@/lib/queries/people");

      currentTestUserId = userAId;
      const result = await updateProfile("Jane From Accounting", "UTC");
      expect(result.ok).toBe(true);

      const resolved = await resolvePeople([userAId]);
      const person = resolved.get(userAId);

      expect(person?.name).toBe("Jane From Accounting");
      // Confirms this is genuinely a *replacement* of the email, not just
      // a name that happens to be returned alongside it.
      expect(person?.name).not.toBe(userAEmail);
    });

    it("AS-202: a user who has never set a display name is resolved by the local part of their email, not the full address (resolver fallback chain fix)", async () => {
      const { resolvePeople } = await import("@/lib/queries/people");

      const resolved = await resolvePeople([userCId]);
      const person = resolved.get(userCId);

      const expectedLocalPart = userCEmail.slice(0, userCEmail.indexOf("@"));
      expect(person?.name).toBe(expectedLocalPart);
      expect(person?.name).not.toBe(userCEmail);
      // The full email is still available on the resolved record itself
      // (e.g. for a mailto link) — only the display "name" is shortened.
      expect(person?.email).toBe(userCEmail);
    });

    it("AS-202: a user cannot update someone else's profile through this action — calling it as user A never changes user B's row", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");

      currentTestUserId = userAId;
      const result = await updateProfile("Attempted Overwrite", "UTC");
      expect(result.ok).toBe(true);

      // The action takes no target-user argument at all — every call is
      // scoped to whichever session is calling it. User B's previously
      // seeded row must be completely untouched by user A's call.
      const { data: userBAfter, error } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userBId)
        .single();
      expect(error).toBeNull();
      expect(userBAfter?.display_name).toBe("Original B Name");

      // And user A's own row did change — proving the action actually
      // writes somewhere, just never to another user's row.
      const { data: userAAfter } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userAId)
        .single();
      expect(userAAfter?.display_name).toBe("Attempted Overwrite");
    });

    it("rejects an unauthenticated caller", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");

      currentTestUserId = null;

      const result = await updateProfile("Nobody", "UTC");
      expect(result.ok).toBe(false);
    });

    it("rejects an empty display name (Zod validation, before any write)", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");

      currentTestUserId = userAId;

      const { data: before } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userAId)
        .single();

      const result = await updateProfile("   ", "UTC");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      const { data: after } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userAId)
        .single();
      expect(after?.display_name).toBe(before?.display_name);
    });

    it("rejects a timezone value that is not a real IANA identifier", async () => {
      const { updateProfile } = await import("@/lib/actions/profile");

      currentTestUserId = userAId;

      const result = await updateProfile("Valid Name", "Not/A_Real_Zone");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });
  },
);
