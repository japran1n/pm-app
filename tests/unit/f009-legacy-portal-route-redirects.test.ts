// Mission 20260914-portal-simplify, F009 (AS-017): "Visiting old
// p/approvals, p/your-list, p/requests redirects to the new routes; no
// in-app link points to the old routes."
//
// Two halves: the three project-scoped legacy routes really do redirect
// (unit-level, `next/navigation`'s `redirect` mocked to throw, same
// pattern `tests/integration/f003b-relocate-portal-routes.test.ts`
// already established for the sibling files/requests legacy routes), and
// a grep-style sweep proving no portal-context source file still links
// to `/approvals`, `/your-list`, or a project-scoped `/requests` path.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("F009 / AS-017: legacy project-scoped portal routes redirect", () => {
  it("test_AS_017_p_approvals_redirects_to_for_you_filter_decisions", async () => {
    const { default: LegacyApprovalsRedirect } = await import(
      "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page"
    );

    await expect(
      LegacyApprovalsRedirect({
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/portal/acme/p/proj-1/for-you?filter=decisions",
    );
  });

  it("test_AS_017_p_approvals_redirect_preserves_approvalId", async () => {
    const { default: LegacyApprovalsRedirect } = await import(
      "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page"
    );

    await expect(
      LegacyApprovalsRedirect({
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
        searchParams: Promise.resolve({ approvalId: "appr-9" }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/portal/acme/p/proj-1/for-you?filter=decisions&approvalId=appr-9",
    );
  });

  it("test_AS_017_p_your_list_redirects_to_for_you_filter_materials", async () => {
    const { default: LegacyYourListRedirect } = await import(
      "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page"
    );

    await expect(
      LegacyYourListRedirect({
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/portal/acme/p/proj-1/for-you?filter=materials",
    );
  });

  it("test_AS_017_p_requests_redirects_to_conversation", async () => {
    const { default: LegacyRequestsRedirect } = await import(
      "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/requests/page"
    );

    await expect(
      LegacyRequestsRedirect({
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/portal/acme/p/proj-1/conversation");
  });

  it("test_AS_017_the_legacy_workspace_level_requests_url_lands_on_conversation_not_the_old_project_scoped_requests_route", async () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(portal)/portal/[workspaceSlug]/requests/page.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("/conversation");
    expect(source).not.toMatch(/p\/\$\{[^}]+\}\/requests`/);
  });
});

// F013 (AS-017) widened this sweep from just the portal-specific
// directories to the app's whole source tree -- the M2 scrutiny finding
// was that a stale link can live anywhere reachable from the portal
// (e.g. `components/approvals/approvals-queue.tsx`, a *workspace*
// component that nonetheless builds a client-facing portal URL), so
// scoping to `app/(portal)`, `components/portal`, `lib/portal` alone let
// exactly that kind of offender through. Scanning the whole tree instead
// and excluding by rule: the workspace-side `/w/...` routes (a
// literally different, team-facing app section) and the team's OWN
// "approvals" inbox naming, which share the substring "approvals" with
// the client-facing portal concept but are a different feature.
const SOURCE_ROOTS = ["app", "components", "lib"];

const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", ".next", "(workspace)"]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (
      SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
}

// A stale link to a project-scoped `/approvals` or `/your-list` path, or
// a project-scoped `/requests` path. Deliberately requires a `/portal/`
// prefix somewhere earlier on the same line -- the client-facing portal
// is the only surface these old routes ever lived under. This is what
// keeps the team's OWN `/w/${workspaceSlug}/approvals` inbox link (a
// different, unrelated route this mission never touched -- see
// `components/nav/app-sidebar.tsx`, `components/brief/
// brief-approval-status.tsx`) and the workspace-level `/w/.../requests`
// team inbox out of this sweep now that it scans the whole tree, not
// just portal-specific directories.
function hasLegacyRouteLink(source: string, segment: "approvals" | "your-list" | "requests"): boolean {
  const pattern = new RegExp(`\\/portal\\/[^"'\`]*\\/${segment}(["'\`?]|$)`, "m");
  return pattern.test(source);
}

describe("F009 / AS-017: no in-app portal link points at the old routes", () => {
  it("test_AS_017_no_portal_source_file_links_to_the_old_approvals_or_your_list_routes", () => {
    const files: string[] = [];
    for (const root of SOURCE_ROOTS) {
      walk(join(process.cwd(), root), files);
    }

    const offenders: string[] = [];
    for (const file of files) {
      // The legacy redirect pages themselves are exempt: their whole job
      // is to name the old URL as the ROUTE THEY LIVE AT, not to link to
      // it -- distinguishing "this file's own path" from "a link inside
      // it" would require parsing the route tree; simpler and just as
      // safe to exempt the three known legacy pages/tests by name.
      if (
        file.endsWith("approvals/page.tsx") ||
        file.endsWith("your-list/page.tsx")
      ) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (hasLegacyRouteLink(source, "approvals") || hasLegacyRouteLink(source, "your-list")) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("test_AS_017_no_portal_source_file_links_to_the_old_project_scoped_requests_route", () => {
    const files: string[] = [];
    for (const root of SOURCE_ROOTS) {
      walk(join(process.cwd(), root), files);
    }

    const offenders: string[] = [];
    for (const file of files) {
      // Exempt the legacy redirect pages themselves (both the
      // project-scoped one and the workspace-level one that redirects
      // INTO the project-scoped one) -- their own header comments and
      // route location legitimately name the old URL as the route they
      // occupy, not as a link to it.
      if (
        file.endsWith("p/[projectId]/requests/page.tsx") ||
        file.endsWith("[workspaceSlug]/requests/page.tsx")
      ) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (hasLegacyRouteLink(source, "requests")) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  // F013 (AS-017): with the sweep now covering the whole `app`,
  // `components`, `lib` tree (see the `SOURCE_ROOTS` comment above), the
  // specific call sites this feature previously had to name by hand
  // (a task-detail approval-card affordance, the change-requests table,
  // and the client that builds the approvals-queue "Copy link" URL) are
  // covered automatically -- this is a direct regression check on those
  // exact files so a future refactor that moves them out of `SOURCE_ROOTS`
  // still catches a reintroduced legacy link.
  it("test_AS_017_the_known_non_portal_directory_call_sites_do_not_link_to_the_old_routes", () => {
    const knownCallSites = [
      "components/portal/approval-card.tsx",
      "components/portal/change-requests-table.tsx",
      "lib/portal/build-waiting-on-you-items.ts",
      "components/approvals/approvals-queue.tsx",
    ];
    for (const relativePath of knownCallSites) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(hasLegacyRouteLink(source, "approvals")).toBe(false);
      expect(hasLegacyRouteLink(source, "your-list")).toBe(false);
      expect(hasLegacyRouteLink(source, "requests")).toBe(false);
    }
  });
});
