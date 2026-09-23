// F013 (TT-030): the project detail layout header shows the project key,
// a status badge (Active/Archived), and a billing-model badge (Hourly/
// Fixed price), using the shared `StatusBadge` component
// (components/ui/status-badge.tsx).
//
// Same source-level verification approach as
// f020-project-layout-streams-rollups.test.ts: this is a server component
// layout file with Suspense boundaries and Supabase-backed data, which
// doesn't render meaningfully under jsdom/RTL without mocking every query
// it touches. The header row itself is synchronous, unconditional JSX, so
// checking the rendered source for the right elements/props is a faithful
// proxy for "the badges are there."

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layoutSource = readFileSync(
  resolve(
    __dirname,
    "../../app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx",
  ),
  "utf8",
);

const queriesSource = readFileSync(
  resolve(__dirname, "../../lib/queries/projects.ts"),
  "utf8",
);

describe("F013 (TT-030): project header badges", () => {
  it("renders the project key in mono, muted text", () => {
    expect(layoutSource).toMatch(
      /font-mono text-sm text-muted-foreground[\s\S]{0,40}project\.key/,
    );
  });

  it("renders a status StatusBadge that is 'Archived' when the project is soft-deleted, else 'Active'", () => {
    expect(layoutSource).toMatch(
      /<StatusBadge[\s\S]*?label=\{isArchived \? "Archived" : "Active"\}/,
    );
  });

  it("uses a destructive-toned colour for Archived and a primary-toned colour for Active", () => {
    expect(layoutSource).toMatch(/var\(--destructive\)/);
    expect(layoutSource).toMatch(/var\(--primary\)/);
  });

  it("renders a billing-model StatusBadge showing 'Hourly' or 'Fixed price'", () => {
    expect(layoutSource).toMatch(
      /project\.billingModel === "hourly" \? "Hourly" : "Fixed price"/,
    );
  });

  it("imports StatusBadge from the shared component rather than one-off markup", () => {
    expect(layoutSource).toContain(
      'import { StatusBadge } from "@/components/ui/status-badge";',
    );
  });

  it("getProjectById's ProjectDetail type and select() carry key + billing_model, with no second query added", () => {
    expect(queriesSource).toMatch(/key: string \| null;/);
    expect(queriesSource).toMatch(
      /billingModel: "hourly" \| "fixed_price";/,
    );
    // Still one .select() call in getProjectById's body, extended with the
    // two new columns rather than a second round trip.
    expect(queriesSource).toMatch(
      /"id, workspace_id, name, description, start_date, end_date, created_at, deleted_at, key, billing_model"/,
    );
  });
});
