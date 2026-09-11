// Unit tests for F073 (AS-144: the team can edit the generated
// document's text).
//
// The brief document is a normal `docs` row (`doc_kind = 'brief'`,
// F047/F071) -- no separate brief-document editor exists. Editing goes
// through the existing project docs route
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/
// page.tsx -> components/docs/markdown-editor.tsx -> lib/actions/docs.ts's
// updateDoc), which fetches a doc purely by id + project scope with no
// doc_kind filter -- so a brief doc already renders and saves there
// exactly like any other doc.
//
// This feature only needed to (1) confirm that route/editor place no
// doc_kind restriction in the way, (2) widen `docKindSchema`/`DocKind`/
// the editor's kind-label map to include 'brief' (so the kind selector
// never receives a value it can't validate for a brief doc -- it
// previously only knew the seven pre-F047 kinds), and (3) make sure the
// brief team page links to the doc so a team member can reach the
// editor at all (AS-143's toggle test file covers the link itself).
//
// updateDoc/getDocById call createClient()/a live Supabase client, so
// exercising the actual save round-trip is an integration concern (same
// documented precedent as F071/F072's test files). This file verifies
// the route has no kind gate and that 'brief' is now a first-class,
// editable doc kind throughout the validation/type/label surface the
// editor depends on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { docKindSchema } from "@/lib/validation/project-site";
import * as docsActions from "@/lib/actions/docs";

describe("F073 AS-144: 'brief' is an editable doc kind", () => {
  it("docKindSchema accepts 'brief'", () => {
    const parsed = docKindSchema.safeParse("brief");
    expect(parsed.success).toBe(true);
  });

  it("the editor's kind-label map has an entry for 'brief' (no blank/unmapped label)", () => {
    const source = readFileSync(
      join(process.cwd(), "components/docs/markdown-editor.tsx"),
      "utf8",
    );
    const labelsStart = source.indexOf("const DOC_KIND_LABELS");
    const labelsEnd = source.indexOf("};", labelsStart);
    const labelsBlock = source.slice(labelsStart, labelsEnd);
    expect(labelsBlock).toContain("brief:");
  });
});

describe("F073 AS-144: the project docs editor route has no doc_kind gate", () => {
  it("the [docId] page fetches by id + project scope only, not by doc_kind", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("getDocById(docId)");
    expect(source).not.toContain('doc.docKind !==');
    expect(source).not.toContain("doc_kind");
  });

  it("renders MarkdownEditor (the same editable-text UI every other doc uses)", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("<MarkdownEditor");
    expect(source).toContain("initialContent={doc.content}");
  });
});

describe("F073 AS-144: the brief team page links to the generated document's editor route", () => {
  it("links to /projects/[projectId]/docs/[docId] for the existing brief doc", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/\/projects\/\$\{projectId\}\/docs\/\$\{existingDocument\.id\}/);
  });

  it("also redirects to the doc editor immediately after generating it", () => {
    const source = readFileSync(
      join(process.cwd(), "components/brief/generate-document-button.tsx"),
      "utf8",
    );
    expect(source).toMatch(/\/docs\/\$\{result\.documentId\}/);
  });
});

describe("F073: updateDoc (the save path every doc, including brief, uses) is exported", () => {
  it("exports updateDoc", () => {
    expect(typeof docsActions.updateDoc).toBe("function");
  });
});
