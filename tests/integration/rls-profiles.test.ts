// Integration test for F120 `profiles` (AS-201, AS-208, AS-209, AS-210).
//
// Verifies against the real linked Supabase project that:
//  - a profile row is created automatically the moment a user is created,
//    with no manual insert (AS-201)
//  - a signed-in user cannot UPDATE another user's profile via a direct
//    API call, even when they share a workspace with that user (AS-208)
//  - a member of a shared workspace CAN read another member's
//    display_name/avatar_url (AS-209)
//  - a user with no shared workspace with the target gets zero rows, not
//    an error, when reading that user's profile (AS-210)
//  - the anon/publishable key with no session reading `profiles` returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-comments.test.ts (F058) and
// tests/integration/rls-workspaces.test.ts (F012).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

describe.skipIf(!haveCoreCreds)("RLS on profiles (F120) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-210: anon/publishable key with no session reading profiles returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("profiles").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "profiles: auto-create on signup, self-only edit, shared-workspace visibility (F120)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let memberAUserId: string;
    let memberAEmail: string;
    let memberAPassword: string;
    let memberA2UserId: string;
    let memberA2Email: string;
    let memberA2Password: string;
    let nonMemberUserId: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let memberAClient: SupabaseClient;
    let memberA2Client: SupabaseClient;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Workspace A holds member-A and member-A2 (share a workspace with
      // each other). Workspace B holds only the non-member, who shares no
      // workspace with either member of A.
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F120 RLS workspace A", slug: `f120-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F120 RLS workspace B", slug: `f120-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      // member-A: creating this user is what exercises AS-201 below (the
      // on_auth_user_created trigger must fire without any manual insert).
      memberAEmail = `f120-member-a-${uniqueSuffix}@example.com`;
      memberAPassword = "Test-password-1!";
      const { data: memberAAuth, error: memberAAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberAEmail,
          password: memberAPassword,
          email_confirm: true,
        });
      if (memberAAuthErr || !memberAAuth.user) {
        throw new Error(`Failed to create member-A test user: ${memberAAuthErr?.message}`);
      }
      memberAUserId = memberAAuth.user.id;

      const { error: memberAInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: memberAUserId,
        role: "owner",
        status: "active",
      });
      if (memberAInsertErr) {
        throw new Error(`Failed to seed member-A membership: ${memberAInsertErr.message}`);
      }

      // Give member-A a display name/avatar to assert AS-209 visibility on
      // real (non-null) data, via the admin client (bypasses RLS, standing
      // in for a Server Action write which is out of this feature's scope).
      const { error: memberAProfileUpdateErr } = await adminClient
        .from("profiles")
        .update({ display_name: "F120 Member A", avatar_url: "https://example.com/a.png" })
        .eq("id", memberAUserId);
      if (memberAProfileUpdateErr) {
        throw new Error(`Failed to seed member-A profile: ${memberAProfileUpdateErr.message}`);
      }

      // member-A2: also in workspace A, used to prove a fellow member (not
      // just the profile owner) can read member-A's profile (AS-209).
      memberA2Email = `f120-member-a2-${uniqueSuffix}@example.com`;
      memberA2Password = "Test-password-1!";
      const { data: memberA2Auth, error: memberA2AuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberA2Email,
          password: memberA2Password,
          email_confirm: true,
        });
      if (memberA2AuthErr || !memberA2Auth.user) {
        throw new Error(`Failed to create member-A2 test user: ${memberA2AuthErr?.message}`);
      }
      memberA2UserId = memberA2Auth.user.id;

      const { error: memberA2InsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: memberA2UserId,
        role: "member",
        status: "active",
      });
      if (memberA2InsertErr) {
        throw new Error(`Failed to seed member-A2 membership: ${memberA2InsertErr.message}`);
      }

      // non-member: in workspace B only, shares no workspace with A/A2.
      nonMemberEmail = `f120-nonmember-${uniqueSuffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: nonMemberPassword,
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member test user: ${nonMemberAuthErr?.message}`);
      }
      nonMemberUserId = nonMemberAuth.user.id;

      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberUserId,
        role: "owner",
        status: "active",
      });
      if (nonMemberInsertErr) {
        throw new Error(`Failed to seed non-member membership in workspace B: ${nonMemberInsertErr.message}`);
      }

      memberAClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberASignInErr } = await memberAClient.auth.signInWithPassword({
        email: memberAEmail,
        password: memberAPassword,
      });
      if (memberASignInErr) {
        throw new Error(`Failed to sign in member-A test user: ${memberASignInErr.message}`);
      }

      memberA2Client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberA2SignInErr } = await memberA2Client.auth.signInWithPassword({
        email: memberA2Email,
        password: memberA2Password,
      });
      if (memberA2SignInErr) {
        throw new Error(`Failed to sign in member-A2 test user: ${memberA2SignInErr.message}`);
      }

      nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: nonMemberSignInErr } = await nonMemberClient.auth.signInWithPassword({
        email: nonMemberEmail,
        password: nonMemberPassword,
      });
      if (nonMemberSignInErr) {
        throw new Error(`Failed to sign in non-member test user: ${nonMemberSignInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup so re-runs stay clean. Deleting the auth user
      // cascades... actually profiles.id FKs auth.users with no ON DELETE
      // clause, so delete profiles first to avoid an FK violation blocking
      // user cleanup.
      for (const userId of [memberAUserId, memberA2UserId, nonMemberUserId]) {
        if (userId) {
          await adminClient.from("profiles").delete().eq("id", userId);
        }
      }
      if (workspaceAId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceAId);
        await adminClient.from("workspaces").delete().eq("id", workspaceAId);
      }
      if (workspaceBId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceBId);
        await adminClient.from("workspaces").delete().eq("id", workspaceBId);
      }
      for (const userId of [memberAUserId, memberA2UserId, nonMemberUserId]) {
        if (userId) {
          await adminClient.auth.admin.deleteUser(userId);
        }
      }
    });

    it("AS-201: a profile row is created automatically on user creation, with no manual insert", async () => {
      const { data, error } = await adminClient
        .from("profiles")
        .select("id, timezone")
        .eq("id", memberAUserId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data?.id).toBe(memberAUserId);
      expect(data?.timezone).toBe("UTC");
    });

    it("AS-201: the backfilled/auto-created profile exists for every seeded test user in this suite", async () => {
      const { data, error } = await adminClient
        .from("profiles")
        .select("id")
        .in("id", [memberAUserId, memberA2UserId, nonMemberUserId]);
      expect(error).toBeNull();
      expect(data?.map((row) => row.id).sort()).toEqual(
        [memberAUserId, memberA2UserId, nonMemberUserId].sort(),
      );
    });

    it("a user can read their own profile", async () => {
      const { data, error } = await memberAClient
        .from("profiles")
        .select("id, display_name")
        .eq("id", memberAUserId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.display_name).toBe("F120 Member A");
    });

    it("AS-209: a fellow member of the same workspace can read the target's display_name and avatar_url", async () => {
      const { data, error } = await memberA2Client
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", memberAUserId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.display_name).toBe("F120 Member A");
      expect(data?.[0]?.avatar_url).toBe("https://example.com/a.png");
    });

    it("AS-210: a user with no shared workspace gets zero rows reading the target's profile, not an error", async () => {
      const { data, error } = await nonMemberClient
        .from("profiles")
        .select("*")
        .eq("id", memberAUserId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-210: the non-member's own profile is still readable to them (self-select works even with zero shared workspaces with others)", async () => {
      const { data, error } = await nonMemberClient
        .from("profiles")
        .select("id")
        .eq("id", nonMemberUserId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("AS-208: a user cannot UPDATE another user's profile via a direct API call, even a fellow workspace member", async () => {
      const { data, error } = await memberA2Client
        .from("profiles")
        .update({ display_name: "hijacked" })
        .eq("id", memberAUserId)
        .select("id");
      // RLS silently filters the row out of the UPDATE's WHERE match rather
      // than raising — assert no row was affected and the value is
      // unchanged, matching the "filtered, not errored" shape used
      // throughout this schema's RLS.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: unchanged } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", memberAUserId)
        .single();
      expect(unchanged?.display_name).toBe("F120 Member A");
    });

    it("AS-208: a user cannot UPDATE another user's profile even when there is no shared workspace at all", async () => {
      const { data, error } = await nonMemberClient
        .from("profiles")
        .update({ display_name: "hijacked-by-nonmember" })
        .eq("id", memberAUserId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: unchanged } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", memberAUserId)
        .single();
      expect(unchanged?.display_name).toBe("F120 Member A");
    });

    it("a user CAN update their own profile", async () => {
      const { data, error } = await memberAClient
        .from("profiles")
        .update({ display_name: "F120 Member A Renamed" })
        .eq("id", memberAUserId)
        .select("display_name")
        .single();
      expect(error).toBeNull();
      expect(data?.display_name).toBe("F120 Member A Renamed");

      // restore for cleanliness/idempotency of re-runs
      await adminClient
        .from("profiles")
        .update({ display_name: "F120 Member A" })
        .eq("id", memberAUserId);
    });

    it("no client-side INSERT is possible into profiles (rows are created only by the auth.users trigger)", async () => {
      const { error } = await memberAClient
        .from("profiles")
        .insert({ id: memberAUserId, timezone: "UTC" });
      expect(error).not.toBeNull();
    });

    it("no client-side DELETE is possible on profiles", async () => {
      const { data, error } = await memberAClient
        .from("profiles")
        .delete()
        .eq("id", memberAUserId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillThere } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", memberAUserId)
        .maybeSingle();
      expect(stillThere?.id).toBe(memberAUserId);
    });
  },
);
