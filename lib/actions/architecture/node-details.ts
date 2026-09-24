"use server";

// Mission 20260918-architecture-enrichment, F09: thin server-action wrapper
// around getArchitectureNodeDetails (lib/queries/architecture-details.ts) so
// Client Component callers on the Architecture board can invoke the details
// query without importing a server-only module directly. Auth chain mirrors
// createSection/deleteSection in lib/actions/architecture/sections.ts:
// resolve the current user, look up the project's owning workspace via the
// admin client (never trust a client-supplied workspace id), and confirm
// active membership before touching any data.
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { authorizeArchitectureProject } from "@/lib/actions/architecture/authorize";
import { getArchitectureNodeDetails } from "@/lib/queries/architecture-details";

import type { PortalQueryResult } from "@/lib/queries/portal";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

export async function getNodeDetailsForToggle(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureNodeDetails>> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Read authorization: active membership plus project visibility.
  const authz = await authorizeArchitectureProject(admin, user.id, projectId, {
    write: false,
  });

  if (!authz.ok) {
    return { ok: false, error: "Not found." };
  }

  // Discipline estimates are team-only commercial data -- never surfaced to
  // a client-role member, same convention as the query module's own
  // isolation guarantees.
  if (authz.access.role === "client") {
    return { ok: false, error: "Forbidden." };
  }

  return getArchitectureNodeDetails(projectId);
}
