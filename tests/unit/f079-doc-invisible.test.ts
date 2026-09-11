// Unit tests for F079 (AS-162: a client cannot see the brief document
// while it is not client-visible).
//
// F072 already established that the generated brief document
// (`docs`, doc_kind = 'brief') defaults `client_visible = false` and
// only a team action flips it. This feature verifies the read-side
// enforcement boundary: `docs_select_client`
// (supabase/migrations/20261014010000_f022_links_accounts_docs_
// visibility.sql) requires `client_visible` AND all three of the portal
// conjuncts (client membership, project visibility, portal enabled)
// before a client-role `select` on `docs` returns a row at all -- so a
// non-client-visible brief doc is invisible to the client regardless of
// any UI, the same "RLS is the enforcement boundary" convention this
// mission follows throughout.
//
// Additionally, the portal brief page
// (app/(portal)/portal/[workspaceSlug]/p/[projectId]/brief/page.tsx)
// never links to the underlying `docs` row at all today (it only renders
// the questionnaire) -- so there is no UI surface on the client side
// that could leak a "View document" link ahead of the RLS boundary.
// This test asserts that invariant holds so a future change to that
// page can't silently regress it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("F079 AS-162: docs_select_client requires client_visible AND the 3-conjunct portal check", () => {
  it("the RLS policy conjoins client_visible with client membership, project visibility, and portal-enabled", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261014010000_f022_links_accounts_docs_visibility.sql",
      ),
      "utf8",
    );
    const policyStart = migration.indexOf("create policy docs_select_client");
    expect(policyStart).toBeGreaterThan(-1);
    const policyBody = migration.slice(policyStart, policyStart + 400);

    expect(policyBody).toContain("client_visible");
    expect(policyBody).toContain("public.is_project_client(project_id)");
    expect(policyBody).toContain("public.is_project_visible_to(project_id)");
    expect(policyBody).toContain("public.is_project_portal_enabled(project_id)");

    // all four conditions must be ANDed together, not ORed -- a policy
    // using `or` anywhere in this using() clause would let a
    // non-client-visible doc through on some other condition.
    expect(policyBody).not.toMatch(/\bor\b/);
  });
});

describe("F079 AS-162: the portal brief page never links directly to the doc row", () => {
  it("does not reference a docs id or a 'View document' link that could bypass client_visible", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(portal)/portal/[workspaceSlug]/p/[projectId]/brief/page.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/view document/i);
    expect(source).not.toContain("/docs/");
  });
});

describe("F079 AS-162: the generated brief doc defaults to client_visible = false", () => {
  it("generateBriefDocument's insert never sets client_visible itself", () => {
    const source = readFileSync(join(process.cwd(), "lib/actions/brief.ts"), "utf8");
    const generateFnStart = source.indexOf("export async function generateBriefDocument");
    expect(generateFnStart).toBeGreaterThan(-1);
    const generateFnBody = source.slice(generateFnStart);
    const insertCallEnd = generateFnBody.indexOf('.select("id")');
    const insertCall = generateFnBody.slice(0, insertCallEnd);

    expect(insertCall).not.toContain("client_visible");
  });
});
