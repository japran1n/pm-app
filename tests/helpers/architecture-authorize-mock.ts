// Stand-in for lib/actions/architecture/authorize.ts in unit tests whose
// admin-client stubs only model `tasks`/`page_components`. It routes the
// decision through whatever the test already mocks — requireActiveMembership
// and the permission predicates — so each test keeps controlling
// membership/role/write access the way it did before the project-level
// authorization existed. The real helper is covered by
// tests/unit/architecture-templates-authz.test.ts.
//
// Use from a vi.mock factory:
//   vi.mock("@/lib/actions/architecture/authorize", async () =>
//     (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
//       workspaceFor: () => WORKSPACE_ID,
//     }),
//   );
// Both dependencies are imported at call time so a test's later vi.doMock
// of either one is honoured.

type Config = {
  // Owning workspace of a project; undefined means the project is missing.
  workspaceFor: (projectId: string) => string | undefined;
  slugFor?: (projectId: string) => string | undefined;
  visible?: (projectId: string) => boolean;
  // Page id -> project id. When omitted, any parent id is treated as a page
  // of the row's own project.
  pages?: () => Record<string, string>;
};

type Row = { project_id: string; page_slug?: string | null; parent_task_id: string | null };

async function predicate(
  name: string,
): Promise<((ctx: { role: string }) => boolean) | undefined> {
  const permissions = await import("@/lib/auth/permissions");
  try {
    const fn = (permissions as unknown as Record<string, unknown>)[name];
    return typeof fn === "function" ? (fn as (ctx: { role: string }) => boolean) : undefined;
  } catch {
    // A partial vi.mock of permissions throws on a missing export.
    return undefined;
  }
}

export function architectureAuthorizeMock(config: Config) {
  async function authorizeArchitectureProject(
    admin: unknown,
    userId: string,
    projectId: string,
    options: { write?: boolean; writeGate?: "team" | "task" } = {},
  ) {
    const workspaceId = config.workspaceFor(projectId);
    if (!workspaceId) return { ok: false as const, reason: "not_found" as const };

    const { requireActiveMembership } = await import("@/lib/auth/require-membership");
    const membership = (await requireActiveMembership(
      admin as never,
      workspaceId,
      userId,
    )) as { ok: boolean; role?: string };
    if (!membership.ok || !membership.role) {
      return { ok: false as const, reason: "forbidden" as const };
    }

    if (config.visible && !config.visible(projectId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }

    if (options.write !== false) {
      const gate =
        (await predicate(options.writeGate === "task" ? "canEditTask" : "canTeamWrite")) ??
        (await predicate("canWrite"));
      if (gate && !gate({ role: membership.role })) {
        return { ok: false as const, reason: "forbidden" as const };
      }
    }

    return {
      ok: true as const,
      access: {
        projectId,
        workspaceId,
        workspaceSlug: config.slugFor?.(projectId) ?? "acme",
        role: membership.role,
      },
    };
  }

  async function loadArchitecturePages(_admin: unknown, pageIds: string[]) {
    const pages = config.pages?.();
    const result = new Map<string, string>();
    if (!pages) return null;
    for (const id of pageIds) if (pages[id]) result.set(id, pages[id]);
    return result;
  }

  return {
    authorizeArchitectureProject,
    async authorizeArchitectureProjects(
      admin: unknown,
      userId: string,
      projectIds: string[],
      options?: { write?: boolean; writeGate?: "team" | "task" },
    ) {
      const accessByProject = new Map<string, unknown>();
      for (const projectId of new Set(projectIds)) {
        const result = await authorizeArchitectureProject(admin, userId, projectId, options);
        if (!result.ok) return result;
        accessByProject.set(projectId, result.access);
      }
      return { ok: true as const, accessByProject };
    },
    async areArchitectureSections(_admin: unknown, rows: Row[]) {
      if (rows.length === 0) return false;
      const pages = config.pages?.();
      return rows.every(
        (row) =>
          !row.page_slug &&
          !!row.parent_task_id &&
          (!pages || pages[row.parent_task_id] === row.project_id),
      );
    },
    loadArchitecturePages,
  };
}
