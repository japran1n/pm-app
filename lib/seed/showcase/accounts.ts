// Step 2 of the showcase seed: one shared password on every demo account,
// four new people, profiles, and goodguys-3 memberships.
//
// Passwords are only ever set on demo+*@goodguys.test accounts —
// marketing@goodguys.se and sasa@demo.test are never touched.

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export const SHOWCASE_PASSWORD = "GoodGuys-Demo-2026!";

export type PersonKey =
  | "tom"
  | "anna"
  | "john"
  | "lisa"
  | "gary"
  | "clara"
  | "maja"
  | "marko"
  | "nina"
  | "erik"
  | "marketing";

type PersonSpec = {
  key: PersonKey;
  email: string;
  displayName: string | null; // null = keep whatever is there
  role: "owner" | "admin" | "member" | "viewer" | "guest" | "client";
  timezone: string | null; // null = leave untouched
  color: string;
  demo: boolean; // demo+ account → password is (re)set
};

export const PEOPLE: PersonSpec[] = [
  { key: "tom", email: "demo+owner@goodguys.test", displayName: "Tom Owner", role: "owner", timezone: "Europe/Stockholm", color: "#3670e1", demo: true },
  { key: "anna", email: "demo+admin@goodguys.test", displayName: "Anna Admin", role: "admin", timezone: "Europe/Stockholm", color: "#8b5cf6", demo: true },
  { key: "john", email: "demo+member@goodguys.test", displayName: "John Member", role: "member", timezone: "Europe/Stockholm", color: "#10b981", demo: true },
  { key: "lisa", email: "demo+viewer@goodguys.test", displayName: "Lisa Viewer", role: "viewer", timezone: "Europe/Stockholm", color: "#f59e0b", demo: true },
  { key: "gary", email: "demo+guest@goodguys.test", displayName: "Gary Guest", role: "guest", timezone: "Europe/London", color: "#64748b", demo: true },
  { key: "clara", email: "demo+client@goodguys.test", displayName: "Clara Client", role: "client", timezone: "Europe/Stockholm", color: "#0ea5e9", demo: true },
  { key: "maja", email: "demo+design@goodguys.test", displayName: "Maja Designer", role: "member", timezone: "Europe/Stockholm", color: "#ec4899", demo: true },
  { key: "marko", email: "demo+dev@goodguys.test", displayName: "Marko Developer", role: "member", timezone: "Europe/Belgrade", color: "#14b8a6", demo: true },
  { key: "nina", email: "demo+qa@goodguys.test", displayName: "Nina QA", role: "member", timezone: "Europe/Stockholm", color: "#f97316", demo: true },
  { key: "erik", email: "demo+client2@goodguys.test", displayName: "Erik Lindqvist", role: "client", timezone: "Europe/Stockholm", color: "#22c55e", demo: true },
  // Real account: membership only, never password/profile changes.
  { key: "marketing", email: "marketing@goodguys.se", displayName: null, role: "admin", timezone: null, color: "#6b7280", demo: false },
];

export type People = Record<PersonKey, string>;

async function findUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function setupAccounts(admin: Admin, workspaceId: string): Promise<People> {
  const ids = {} as People;

  for (const person of PEOPLE) {
    let id = await findUserIdByEmail(admin, person.email);

    if (!person.demo) {
      if (!id) throw new Error(`Kept account ${person.email} is missing`);
      ids[person.key] = id;
      continue;
    }

    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        password: SHOWCASE_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`updateUserById(${person.email}): ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: person.email,
        password: SHOWCASE_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: person.displayName },
      });
      if (error || !data.user) {
        throw new Error(`createUser(${person.email}): ${error?.message ?? "no user"}`);
      }
      id = data.user.id;
    }
    ids[person.key] = id;

    // Profiles row is created by the auth trigger; upsert covers both paths.
    // Existing avatars are left alone (avatar_url is not in the payload).
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id,
        display_name: person.displayName,
        color: person.color,
        timezone: person.timezone ?? "UTC",
      },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`profiles upsert ${person.email}: ${profileError.message}`);
  }

  // Memberships in goodguys-3 (role kept in sync with the spec).
  for (const person of PEOPLE) {
    const userId = ids[person.key];
    const { data: existing } = await admin
      .from("workspace_members")
      .select("id, role, status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      if (existing.role !== person.role || existing.status !== "active") {
        if (existing.role === "owner" && person.role !== "owner") continue;
        const { error } = await admin
          .from("workspace_members")
          .update({ role: person.role, status: "active" })
          .eq("id", existing.id);
        if (error) throw new Error(`workspace_members update ${person.email}: ${error.message}`);
      }
      continue;
    }
    const { error } = await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: person.role,
      status: "active",
    });
    if (error) throw new Error(`workspace_members insert ${person.email}: ${error.message}`);
  }

  return ids;
}
