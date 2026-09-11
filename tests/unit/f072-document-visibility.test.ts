// Unit tests for F072 (AS-143: the generated document is not
// client-visible until the team makes it so).
//
// The brief document (F071's generateBriefDocument) is a plain `docs`
// row with `doc_kind = 'brief'`. Visibility is governed by the existing
// `docs.client_visible` column (20261014010000_f022_links_accounts_docs_
// visibility.sql), which defaults to `false` at the database level, and
// the existing `setDocClientVisibility` action (lib/actions/docs.ts),
// which is what F072's "Share with client" toggle
// (components/docs/doc-client-visibility-toggle.tsx, wired onto the
// brief team page) calls to flip it. No new column or action was
// needed -- these tests confirm generateBriefDocument's insert never
// sets `client_visible` itself (so the column default governs, AS-143's
// "not client-visible until shared") and that the toggle path
// (setDocClientVisibility + its Zod schema) accepts exactly the shape a
// share/unshare click sends.
//
// generateBriefDocument itself calls createClient() from
// @/lib/supabase/server, which needs a real request context --
// exercising it against a live Supabase project is an integration
// concern (same documented precedent as tests/unit/f071-generate-brief-
// document.test.ts). This file verifies the insert payload never
// mentions client_visible (by source inspection, since the action isn't
// callable without a live context) and the public toggle surface's
// validation boundary.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as docsActions from "@/lib/actions/docs";
import { setDocClientVisibilitySchema } from "@/lib/validation/project-site";

describe("F072 AS-143: generateBriefDocument never sets client_visible on insert", () => {
  it("the docs insert in generateBriefDocument does not set client_visible, so the column's own default (false) governs", () => {
    const source = readFileSync(join(process.cwd(), "lib/actions/brief.ts"), "utf8");
    const generateFnStart = source.indexOf("export async function generateBriefDocument");
    expect(generateFnStart).toBeGreaterThan(-1);
    const generateFnBody = source.slice(generateFnStart);
    const insertCallEnd = generateFnBody.indexOf(".select(\"id\")");
    const insertCall = generateFnBody.slice(0, insertCallEnd);

    expect(insertCall).toContain('doc_kind: "brief"');
    expect(insertCall).not.toContain("client_visible");
  });
});

describe("F072 AS-143: the docs.client_visible column defaults to false", () => {
  it("the migration that added client_visible declares it NOT NULL DEFAULT false", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261014010000_f022_links_accounts_docs_visibility.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "add column if not exists client_visible boolean not null default false",
    );
  });
});

describe("F072 AS-143: the 'Share with client' toggle uses the existing setDocClientVisibility action", () => {
  it("exports setDocClientVisibility", () => {
    expect(typeof docsActions.setDocClientVisibility).toBe("function");
  });

  it("accepts a valid docId + visible=true payload (sharing)", () => {
    const parsed = setDocClientVisibilitySchema.safeParse({
      docId: "00000000-0000-0000-0000-000000000000",
      visible: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid docId + visible=false payload (hiding again)", () => {
    const parsed = setDocClientVisibilitySchema.safeParse({
      docId: "00000000-0000-0000-0000-000000000000",
      visible: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid docId", () => {
    const parsed = setDocClientVisibilitySchema.safeParse({
      docId: "not-a-uuid",
      visible: true,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("F072: the brief team page wires the toggle onto the generated document", () => {
  it("renders DocClientVisibilityToggle against the existing brief doc, not the questionnaire", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("DocClientVisibilityToggle");
    expect(source).toContain("existingDocument");
    expect(source).toContain("client_visible");
  });
});
