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
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/portal/acme/p/proj-1/for-you?filter=decisions",
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

// Directories that make up the portal's own source tree -- app routes,
// portal-specific components, and the portal-specific lib helpers. Scoped
// deliberately (not the whole repo) so a workspace-side `/w/...` link
// that happens to contain the substring "approvals" (the team's OWN
// approvals inbox, an unrelated feature) never false-positives this
// sweep.
const PORTAL_SOURCE_ROOTS = [
  "app/(portal)",
  "components/portal",
  "lib/portal",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
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

// Also sweep the two known non-portal-directory call sites this feature
// touched, which live outside `PORTAL_SOURCE_ROOTS` but still render
// portal-facing links (a task-detail component's client-visible approval
// card affordance, and the change-requests table shared between the
// workspace side and the portal).
const EXTRA_FILES = [
  "components/portal/approval-card.tsx",
  "components/portal/change-requests-table.tsx",
  "lib/portal/build-waiting-on-you-items.ts",
];

// A stale link to a project-scoped `/approvals` or `/your-list` path, or
// a project-scoped `/requests` path (the workspace-level `/w/.../requests`
// team inbox is a different, unrelated route and must NOT be flagged).
// Deliberately narrow to URL-shaped occurrences (a template interpolation
// or a quoted route literal immediately followed by the segment) so
// `@/lib/queries/approvals` import specifiers and `ApprovalCard`-style
// identifiers never false-positive this sweep.
function hasLegacyRouteLink(source: string, segment: "approvals" | "your-list" | "requests"): boolean {
  const patterns = [
    new RegExp(`\\}\\/${segment}(["'\`?]|$)`, "m"),
    new RegExp(`\\/portal\\/[^"'\`]*\\/${segment}(["'\`?]|$)`, "m"),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

describe("F009 / AS-017: no in-app portal link points at the old routes", () => {
  it("test_AS_017_no_portal_source_file_links_to_the_old_approvals_or_your_list_routes", () => {
    const files: string[] = [];
    for (const root of PORTAL_SOURCE_ROOTS) {
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
    for (const root of PORTAL_SOURCE_ROOTS) {
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

  it("test_AS_017_the_extra_non_portal_directory_call_sites_do_not_link_to_the_old_routes", () => {
    for (const relativePath of EXTRA_FILES) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(hasLegacyRouteLink(source, "approvals")).toBe(false);
      expect(hasLegacyRouteLink(source, "your-list")).toBe(false);
      expect(hasLegacyRouteLink(source, "requests")).toBe(false);
    }
  });
});
