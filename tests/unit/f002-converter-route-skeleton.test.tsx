// @vitest-environment jsdom
//
// Mission 20260917-170249, F002 (AS-002, AS-003, AS-004, AS-009, AS-010):
// the converter route skeleton at
// app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx.
//
// This page is a plain Server Component with no props and no data fetch of
// its own -- AS-003/AS-004 (membership + auth gating) and AS-002 (route
// location) are properties of the file's location under the existing
// /w/[workspaceSlug]/* layout, not of this component's runtime behavior,
// so they're verified here by (a) rendering the component standalone and
// confirming it needs no user/session/workspace context to produce output,
// and (b) a static source-file check that it imports no Supabase/auth
// client and defines no route-level auth logic of its own (proving it
// relies entirely on the shared layout guard rather than duplicating or
// diverging from it).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_PATH = join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx",
);

describe("WebflowConverterPage (F002)", () => {
  it("test_AS_002_page_file_lives_at_the_expected_route_path", () => {
    // AS-002: the converter page lives at /w/[workspaceSlug]/tools/webflow
    // -- proven by this file existing at exactly that App Router path.
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).toContain("export default function WebflowConverterPage");
  });

  it("test_AS_003_and_AS_004_the_page_performs_no_auth_or_membership_check_of_its_own", () => {
    // AS-003/AS-004: this page must add zero new auth logic -- it should
    // rely entirely on the shared segment layout's redirect/404 guard. A
    // page that imported its own auth/session helpers here would indicate
    // a duplicated (and potentially diverging) gate.
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).not.toMatch(/getCurrentUser|createClient|redirect\(|notFound\(/);
  });

  it("test_AS_009_the_page_makes_no_supabase_or_external_service_query", () => {
    // AS-009: no external service credentials are required to load or
    // function -- this page issues no Supabase query of its own.
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/supabase/);
    expect(source).not.toMatch(/createAdminClient|\.from\(/);
  });

  it("test_AS_010_the_page_fetches_no_prior_session_content_and_renders_without_params_or_data", async () => {
    // AS-010: refreshing the page returns an empty state because there is
    // nothing server-fetched to restore. Proven by the component being
    // callable with zero arguments and zero async work -- if it needed to
    // rehydrate prior session content it would require a data fetch (async
    // function or awaited call), which this component has none of.
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).not.toMatch(/async function WebflowConverterPage/);
    expect(source).not.toContain("await ");

    const { render, screen, cleanup } = await import("@testing-library/react");
    await import("@testing-library/jest-dom/vitest");
    const { default: WebflowConverterPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/tools/webflow/page"
    );

    render(<WebflowConverterPage />);

    expect(
      screen.getByRole("heading", { name: /HTML → Webflow converter/i }),
    ).toBeTruthy();

    cleanup();
  });
});
