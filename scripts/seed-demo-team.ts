// Part A of the "kitchen sink" demo-data seed (see scripts/seed-full-demo.ts
// for the single orchestration entrypoint the orchestrator actually runs).
//
// Destructive by design (orchestrator instruction, not guarded):
//   1. Deletes every existing auth user.
//   2. Deletes every row from the app's own data tables.
//   3. Creates exactly 6 new auth users, one per workspace role, with a
//      shared strong random password, auto-confirmed.
//   4. Creates one workspace ("Goodguys Demo") owned by the owner user and
//      adds the other 5 as workspace_members with their matching role.
//   5. Prints a copy-paste-friendly summary.
//
// Deliberately NOT written through the app's "use server" Server Actions
// (lib/actions/*.ts): those import `next/headers`'s `cookies()`, which
// throws outside an active Next.js request/render context and cannot be
// invoked from a standalone script. This script instead uses the same two
// primitives those actions themselves are built on:
//   - the admin (secret-key) client (lib/supabase/admin.ts) for privileged
//     operations RLS has no policy for (deleting other users' data,
//     inserting workspace_members rows for someone other than the caller),
//     exactly like several Server Actions already do internally;
//   - a REAL authenticated session (password sign-in via the publishable
//     key client) for `create_workspace_with_owner`, the one write this
//     script performs that is only granted to the `authenticated` role and
//     reads `auth.uid()` internally (see
//     supabase/migrations/20261104010000_f116_task_type_taxonomy.sql) --
//     an admin-client RPC call would hit that function's own
//     "not authenticated" guard.
//
// Run: npx tsx --env-file=.env scripts/seed-demo-team.ts
// (normally invoked indirectly via scripts/seed-full-demo.ts)

import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../lib/supabase/admin";
import type { Database } from "../lib/supabase/database.types";

export const DEMO_WORKSPACE_NAME = "Goodguys Demo";
export const DEMO_WORKSPACE_SLUG = "goodguys-demo";

export type DemoRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "guest"
  | "client";

export const DEMO_ROLES: DemoRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
  "guest",
  "client",
];

export function demoEmailFor(role: DemoRole): string {
  return `demo+${role}@goodguys.test`;
}

function generateSharedPassword(): string {
  // 24 random bytes -> base64url, then guarantee at least one of each
  // required character class so it also passes any client-side password
  // strength rule the sign-in form enforces.
  const random = randomBytes(24)
    .toString("base64")
    .replace(/[+/=]/g, "")
    .slice(0, 20);
  return `Gg${random}9!`;
}

// Ordered leaf-to-root so FK constraints (not every table cascades off
// `workspaces`, e.g. `projects.workspace_id` has no ON DELETE CASCADE) are
// always satisfied regardless of which ones do. Deleting an already-cascaded
// table's rows here is a harmless no-op.
const TABLES_LEAF_TO_ROOT = [
  // Deepest leaves (children of tasks / comments / channels / docs / etc.)
  "message_reactions",
  "messages",
  "channel_members",
  "channels",
  "comment_reactions",
  "comments",
  "attachments",
  "time_entries",
  "active_timers",
  "task_custom_field_values",
  "checklist_items",
  "task_assignees",
  "task_watchers",
  "task_dependencies",
  "notifications",
  "calendar_blocks",
  "time_off_entries",
  "docs",
  "doc_folders",
  "saved_views",
  "task_templates",
  // Portal / client tables (reference tasks/phases/projects)
  "client_deliverables",
  "project_scope_items",
  "project_decisions",
  "project_assumptions",
  "approval_requests",
  "client_requests",
  "project_custom_fields",
  "project_budgets",
  "project_phases",
  // Tasks themselves
  "tasks",
  // Project-level
  "project_members",
  "project_statuses",
  "projects",
  // Workspace-level
  "task_types",
  "workspace_members",
  "workspaces",
];

async function wipeAllData(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  for (const table of TABLES_LEAF_TO_ROOT) {
    const { error } = await admin
      .from(table as keyof Database["public"]["Tables"] & string)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .delete({ count: "exact" } as any)
      .not("id" as never, "is", null as never);

    if (error) {
      // Some tables have no single `id` PK (composite keys, e.g.
      // task_assignees/task_watchers/channel_members/message_reactions).
      // Fall back to an unconditional delete for those.
      const { error: fallbackError } = await admin
        .from(table as keyof Database["public"]["Tables"] & string)
        .delete()
        .not("created_at" as never, "is", null as never);
      if (fallbackError) {
        console.warn(
          `wipeAllData: could not clear "${table}" (${error.message} / ${fallbackError.message}) -- continuing, likely already empty or cascaded away.`,
        );
      }
    }
  }
}

async function wipeAllAuthUsers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw new Error(`listUsers failed: ${error.message}`);
    }
    if (!data.users.length) break;

    for (const user of data.users) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(
        user.id,
      );
      if (deleteError) {
        console.warn(
          `wipeAllAuthUsers: failed to delete ${user.email ?? user.id}: ${deleteError.message}`,
        );
      }
    }

    // deleteUser shrinks the total user count, so always re-fetch page 1
    // rather than incrementing, until a page comes back empty.
    if (data.users.length < 200) break;
  }
}

export type SeededTeam = {
  workspaceId: string;
  workspaceSlug: string;
  password: string;
  users: Record<DemoRole, { id: string; email: string }>;
};

export async function seedDemoTeam(): Promise<SeededTeam> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY env vars.",
    );
  }

  const admin = createAdminClient();

  console.log("[seed-demo-team] Wiping all existing auth users...");
  await wipeAllAuthUsers(admin);

  console.log("[seed-demo-team] Wiping all existing app data...");
  await wipeAllData(admin);

  const password = generateSharedPassword();

  console.log("[seed-demo-team] Creating 6 demo auth users...");
  const users = {} as Record<DemoRole, { id: string; email: string }>;

  for (const role of DEMO_ROLES) {
    const email = demoEmailFor(role);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { demo_role: role, full_name: `Demo ${role}` },
    });
    if (error || !data.user) {
      throw new Error(
        `createUser(${email}) failed: ${error?.message ?? "no user returned"}`,
      );
    }
    users[role] = { id: data.user.id, email };
  }

  console.log("[seed-demo-team] Creating workspace as owner...");
  // create_workspace_with_owner is granted to `authenticated` only and
  // reads auth.uid() internally -- sign in as the real owner user to get a
  // genuine session for this one RPC call.
  const ownerSession = createSupabaseClient<Database>(
    SUPABASE_URL,
    PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: signInError } = await ownerSession.auth.signInWithPassword({
    email: users.owner.email,
    password,
  });
  if (signInError) {
    throw new Error(`owner sign-in failed: ${signInError.message}`);
  }

  const { data: created, error: createError } = await ownerSession.rpc(
    "create_workspace_with_owner",
    { p_name: DEMO_WORKSPACE_NAME, p_slug: DEMO_WORKSPACE_SLUG },
  );
  if (createError) {
    throw new Error(
      `create_workspace_with_owner failed: ${createError.message}`,
    );
  }
  const workspace = Array.isArray(created) ? created[0] : created;
  if (!workspace) {
    throw new Error("create_workspace_with_owner returned no row");
  }

  console.log("[seed-demo-team] Adding the other 5 members...");
  const otherRoles = DEMO_ROLES.filter((r) => r !== "owner");
  const { error: membersError } = await admin.from("workspace_members").insert(
    otherRoles.map((role) => ({
      workspace_id: workspace.id,
      user_id: users[role].id,
      // workspace_members.role's CHECK constraint was widened to all 6
      // values by supabase/migrations/20260902010000_client_role_and_task_
      // client_visibility.sql ('owner', 'admin', 'member', 'viewer',
      // 'guest', 'client') -- every DemoRole maps 1:1 onto it directly.
      role,
      status: "active",
    })),
  );
  if (membersError) {
    throw new Error(`workspace_members insert failed: ${membersError.message}`);
  }

  await ownerSession.auth.signOut();

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    password,
    users,
  };
}

if (require.main === module) {
  seedDemoTeam()
    .then((result) => {
      console.log("\n[seed-demo-team] Done.");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("[seed-demo-team] FAILED:", error);
      process.exit(1);
    });
}
