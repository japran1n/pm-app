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

    // F276: rewritten to update `timezone` instead of `display_name` — as
    // of this feature, `display_name` is no longer in the authenticated
    // role's UPDATE grant at all (see the "Constrain self-writes" section
    // of supabase/migrations/20260819065751_close_profiles_rls_gaps.sql),
    // so a `display_name` write now fails at the column-privilege layer
    // (42501) for EVERY row, including the caller's own, which would no
    // longer isolate the row-level ("is this someone else's row?") RLS
    // behaviour this test exists to prove. `timezone` stays fully
    // grantable, so this still exercises exactly the "filtered, not
    // errored" RLS shape for a cross-user write attempt.
    it("AS-208: a user cannot UPDATE another user's profile via a direct API call, even a fellow workspace member", async () => {
      const { data, error } = await memberA2Client
        .from("profiles")
        .update({ timezone: "Europe/Stockholm" })
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
        .select("timezone")
        .eq("id", memberAUserId)
        .single();
      expect(unchanged?.timezone).toBe("UTC");
    });

    it("AS-208: a user cannot UPDATE another user's profile even when there is no shared workspace at all", async () => {
      const { data, error } = await nonMemberClient
        .from("profiles")
        .update({ timezone: "Europe/Stockholm" })
        .eq("id", memberAUserId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: unchanged } = await adminClient
        .from("profiles")
        .select("timezone")
        .eq("id", memberAUserId)
        .single();
      expect(unchanged?.timezone).toBe("UTC");
    });

    // F276 hardening: as of this feature, a direct authenticated-role PATCH
    // may only touch `timezone` — see
    // supabase/migrations/20260819065751_close_profiles_rls_gaps.sql's
    // "Constrain self-writes" section. display_name/avatar_url writes now
    // go exclusively through lib/actions/profile.ts's Server Actions
    // (service_role, unaffected by this grant). This test used to PATCH
    // display_name directly and expect success; it's rewritten to exercise
    // the column that direct writes are still allowed to touch, with a new
    // companion test right below proving display_name is now rejected.
    it("a user CAN update their own profile's timezone via a direct API call", async () => {
      const { data, error } = await memberAClient
        .from("profiles")
        .update({ timezone: "America/New_York" })
        .eq("id", memberAUserId)
        .select("timezone")
        .single();
      expect(error).toBeNull();
      expect(data?.timezone).toBe("America/New_York");

      // restore for cleanliness/idempotency of re-runs
      await adminClient
        .from("profiles")
        .update({ timezone: "UTC" })
        .eq("id", memberAUserId);
    });

    it("F276: a direct API call updating display_name (not via the Server Action) is rejected — column-level UPDATE grant no longer covers it", async () => {
      const { data, error } = await memberAClient
        .from("profiles")
        .update({ display_name: "direct-patch-should-fail" })
        .eq("id", memberAUserId)
        .select("display_name");
      expect(error).not.toBeNull();

      const { data: unchanged } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", memberAUserId)
        .single();
      expect(unchanged?.display_name).toBe("F120 Member A");
      expect(data).toBeFalsy();
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

// ---------------------------------------------------------------------------
// F276 (AS-210, major): soft-deleting the shared workspace must revoke
// profile visibility. Before
// supabase/migrations/20260819065751_close_profiles_rls_gaps.sql,
// `shares_workspace_with()` never checked `workspaces.deleted_at`, so two
// users whose only shared workspace was soft-deleted kept permanent,
// unrevocable read access to each other's profile. This test fails against
// the pre-fix function (the read would still return the row) and passes
// after it (the read drops to zero rows).
//
// Self-contained describe block with its own workspace/users, rather than
// reusing the block above's workspace A — this test destructively
// soft-deletes its workspace, which must not affect the AS-209/AS-201/etc.
// tests above that depend on workspace A staying alive for the whole file.
// ---------------------------------------------------------------------------
describe.skipIf(!haveAdminCreds)(
  "F276 AS-210: soft-deleting the shared workspace revokes profile visibility",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let userXId: string;
    let userXEmail: string;
    let userYId: string;
    let userYEmail: string;
    let userYClient: SupabaseClient;
    const password = "Test-password-1!";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F276 soft-delete workspace", slug: `f276-softdel-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      userXEmail = `f276-userx-${uniqueSuffix}@example.com`;
      const { data: authX, error: authXErr } = await adminClient.auth.admin.createUser({
        email: userXEmail,
        password,
        email_confirm: true,
      });
      if (authXErr || !authX.user) {
        throw new Error(`Failed to create user X: ${authXErr?.message}`);
      }
      userXId = authX.user.id;

      userYEmail = `f276-usery-${uniqueSuffix}@example.com`;
      const { data: authY, error: authYErr } = await adminClient.auth.admin.createUser({
        email: userYEmail,
        password,
        email_confirm: true,
      });
      if (authYErr || !authY.user) {
        throw new Error(`Failed to create user Y: ${authYErr?.message}`);
      }
      userYId = authY.user.id;

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: userXId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: userYId, role: "member", status: "active" },
      ]);
      if (membersErr) {
        throw new Error(`Failed to seed memberships: ${membersErr.message}`);
      }

      userYClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userYClient.auth.signInWithPassword({
        email: userYEmail,
        password,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in user Y: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      for (const userId of [userXId, userYId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("F276 AS-210: sanity check — while the workspace is active, user Y can read user X's profile", async () => {
      const { data, error } = await userYClient
        .from("profiles")
        .select("id")
        .eq("id", userXId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("F276 AS-210: after the shared workspace is soft-deleted, user Y reading user X's profile drops to zero rows", async () => {
      const { error: softDeleteErr } = await adminClient
        .from("workspaces")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", workspaceId);
      expect(softDeleteErr).toBeNull();

      const { data, error } = await userYClient
        .from("profiles")
        .select("id")
        .eq("id", userXId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// F276 (AS-210): removing a member's workspace_members row must also revoke
// profile visibility — the case scrutiny called out as already working
// correctly ("member removal genuinely deletes the row, so revocation works
// there") but had no test proving it. Added here alongside the soft-delete
// regression test for full FU-4 coverage.
// ---------------------------------------------------------------------------
describe.skipIf(!haveAdminCreds)(
  "F276 AS-210: removing a member's workspace_members row revokes profile visibility",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let userPId: string;
    let userPEmail: string;
    let userQId: string;
    let userQEmail: string;
    let userQClient: SupabaseClient;
    const password = "Test-password-1!";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F276 remove-member workspace", slug: `f276-removemem-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      userPEmail = `f276-userp-${uniqueSuffix}@example.com`;
      const { data: authP, error: authPErr } = await adminClient.auth.admin.createUser({
        email: userPEmail,
        password,
        email_confirm: true,
      });
      if (authPErr || !authP.user) {
        throw new Error(`Failed to create user P: ${authPErr?.message}`);
      }
      userPId = authP.user.id;

      userQEmail = `f276-userq-${uniqueSuffix}@example.com`;
      const { data: authQ, error: authQErr } = await adminClient.auth.admin.createUser({
        email: userQEmail,
        password,
        email_confirm: true,
      });
      if (authQErr || !authQ.user) {
        throw new Error(`Failed to create user Q: ${authQErr?.message}`);
      }
      userQId = authQ.user.id;

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: userPId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: userQId, role: "member", status: "active" },
      ]);
      if (membersErr) {
        throw new Error(`Failed to seed memberships: ${membersErr.message}`);
      }

      userQClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userQClient.auth.signInWithPassword({
        email: userQEmail,
        password,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in user Q: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      for (const userId of [userPId, userQId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("F276 AS-210: sanity check — while both are active members, user Q can read user P's profile", async () => {
      const { data, error } = await userQClient
        .from("profiles")
        .select("id")
        .eq("id", userPId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("F276 AS-210: after user Q's membership row is removed, user Q reading user P's profile drops to zero rows", async () => {
      const { error: removeErr } = await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", userQId);
      expect(removeErr).toBeNull();

      const { data, error } = await userQClient
        .from("profiles")
        .select("id")
        .eq("id", userPId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// F276 (AS-208 hardening): the WITH CHECK path was previously untested —
// scrutiny's exact words: "No test attempts update({ id: otherUserId })
// .eq("id", myUserId)); removing with check (id = auth.uid()) would leave
// the whole suite green." This attempts exactly that call and asserts
// rejection. As of this feature, this is rejected by two independent
// layers: the narrowed column-level UPDATE grant (authenticated may only
// SET timezone, so attempting to SET id fails with a permission error
// before RLS is even evaluated) and, if that grant were ever loosened
// again, profiles_update_self's `with check (id = auth.uid())`.
// ---------------------------------------------------------------------------
describe.skipIf(!haveAdminCreds)(
  "F276 AS-208: update({ id: otherUserId }).eq(\"id\", myUserId) is rejected",
  () => {
    let adminClient: SupabaseClient;
    let userMId: string;
    let userMEmail: string;
    let userMClient: SupabaseClient;
    let userNId: string;
    let userNEmail: string;
    const password = "Test-password-1!";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      userMEmail = `f276-userm-${uniqueSuffix}@example.com`;
      const { data: authM, error: authMErr } = await adminClient.auth.admin.createUser({
        email: userMEmail,
        password,
        email_confirm: true,
      });
      if (authMErr || !authM.user) {
        throw new Error(`Failed to create user M: ${authMErr?.message}`);
      }
      userMId = authM.user.id;

      userNEmail = `f276-usern-${uniqueSuffix}@example.com`;
      const { data: authN, error: authNErr } = await adminClient.auth.admin.createUser({
        email: userNEmail,
        password,
        email_confirm: true,
      });
      if (authNErr || !authN.user) {
        throw new Error(`Failed to create user N: ${authNErr?.message}`);
      }
      userNId = authN.user.id;

      userMClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userMClient.auth.signInWithPassword({
        email: userMEmail,
        password,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in user M: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      for (const userId of [userMId, userNId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("F276 AS-208: attempting to reassign one's own row's id to another user's id is rejected, and neither row is changed", async () => {
      const { data, error } = await userMClient
        .from("profiles")
        .update({ id: userNId })
        .eq("id", userMId)
        .select("id");
      expect(error).not.toBeNull();
      expect(data).toBeFalsy();

      const { data: mStillThere } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", userMId)
        .maybeSingle();
      expect(mStillThere?.id).toBe(userMId);

      const { data: nUnchanged } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", userNId)
        .maybeSingle();
      expect(nUnchanged?.id).toBe(userNId);
    });
  },
);

// ---------------------------------------------------------------------------
// F276: a cross-user Storage write against the avatars bucket, with two real
// user JWTs, must be rejected. avatars_objects_insert_own/update_own
// (20260818201642_create_avatars_bucket.sql) already scope writes to the
// caller's own `{user_id}/avatar` path prefix, but nothing in the suite
// exercised it with a second real signed-in user attempting to write into
// the first user's path — this closes that gap per the FU-4 recommendation.
// ---------------------------------------------------------------------------
describe.skipIf(!haveAdminCreds)(
  "F276: cross-user Storage write against another user's avatar path is rejected",
  () => {
    let adminClient: SupabaseClient;
    let userRId: string;
    let userREmail: string;
    let userSId: string;
    let userSEmail: string;
    let userSClient: SupabaseClient;
    const password = "Test-password-1!";
    const BUCKET = "avatars";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      userREmail = `f276-userr-${uniqueSuffix}@example.com`;
      const { data: authR, error: authRErr } = await adminClient.auth.admin.createUser({
        email: userREmail,
        password,
        email_confirm: true,
      });
      if (authRErr || !authR.user) {
        throw new Error(`Failed to create user R: ${authRErr?.message}`);
      }
      userRId = authR.user.id;

      userSEmail = `f276-users-${uniqueSuffix}@example.com`;
      const { data: authS, error: authSErr } = await adminClient.auth.admin.createUser({
        email: userSEmail,
        password,
        email_confirm: true,
      });
      if (authSErr || !authS.user) {
        throw new Error(`Failed to create user S: ${authSErr?.message}`);
      }
      userSId = authS.user.id;

      userSClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userSClient.auth.signInWithPassword({
        email: userSEmail,
        password,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in user S: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort: remove anything that might have landed under either
      // prefix (should be nothing under user R's, given the assertion
      // below, but cleanup stays defensive).
      for (const userId of [userRId, userSId]) {
        const { data: listed } = await adminClient.storage.from(BUCKET).list(userId);
        if (listed && listed.length > 0) {
          await adminClient.storage
            .from(BUCKET)
            .remove(listed.map((obj) => `${userId}/${obj.name}`));
        }
      }
      for (const userId of [userRId, userSId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("F276: user S cannot INSERT an object under user R's avatar path", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const { error } = await userSClient.storage
        .from(BUCKET)
        .upload(`${userRId}/avatar`, bytes, { contentType: "image/png" });
      expect(error).not.toBeNull();

      const { data: listed } = await adminClient.storage.from(BUCKET).list(userRId);
      expect((listed ?? []).length).toBe(0);
    });

    it("F276: user S cannot UPDATE (upsert) an object under user R's avatar path either", async () => {
      // Seed an object at R's path via the admin client first, so this
      // exercises the UPDATE policy path (upsert against an existing
      // object), not just INSERT.
      const seedBytes = new Uint8Array([9, 9, 9]);
      const { error: seedErr } = await adminClient.storage
        .from(BUCKET)
        .upload(`${userRId}/avatar`, seedBytes, {
          contentType: "image/png",
          upsert: true,
        });
      expect(seedErr).toBeNull();

      const attackBytes = new Uint8Array([6, 6, 6]);
      const { error } = await userSClient.storage
        .from(BUCKET)
        .upload(`${userRId}/avatar`, attackBytes, {
          contentType: "image/png",
          upsert: true,
        });
      expect(error).not.toBeNull();

      // The seeded bytes must be untouched by user S's rejected attempt.
      const response = await fetch(
        adminClient.storage.from(BUCKET).getPublicUrl(`${userRId}/avatar`).data.publicUrl,
      );
      const servedBytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(servedBytes)).toEqual(Array.from(seedBytes));
    });
  },
);
