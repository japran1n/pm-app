import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";

// Validates create-workspace input (AS-006) before it reaches Supabase.
export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

// Turns "My Team!!" into "my-team", collapsing non-alphanumerics to single
// hyphens and trimming leading/trailing ones. Falls back to "workspace" if
// the name has no URL-safe characters at all (e.g. an all-emoji name).
//
// Lives outside lib/actions/workspaces.ts (a "use server" file) because
// every export of a "use server" module must itself be an async Server
// Action — a plain sync helper like this fails the Next.js build.
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

// Finds a unique slug by appending -2, -3, ... on collision. Takes the admin
// client because uniqueness must be checked against all workspaces, not just
// ones the caller (who may not be a member of any yet) can see under RLS.
export async function findAvailableSlug(
  admin: ReturnType<typeof createAdminClient>,
  baseSlug: string,
): Promise<string> {
  const { data: existing, error } = await admin
    .from("workspaces")
    .select("slug")
    .like("slug", `${baseSlug}%`);

  if (error) {
    console.error("createWorkspace: slug uniqueness check failed:", error);
    // Fall back to the base slug; the insert's unique constraint on `slug`
    // is the final backstop if this races with another creation.
    return baseSlug;
  }

  const taken = new Set((existing ?? []).map((row) => row.slug));
  if (!taken.has(baseSlug)) {
    return baseSlug;
  }

  let n = 2;
  while (taken.has(`${baseSlug}-${n}`)) {
    n += 1;
  }
  return `${baseSlug}-${n}`;
}
