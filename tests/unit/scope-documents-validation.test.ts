import { describe, expect, it } from "vitest";

import {
  createScopeDocumentLinkSchema,
  deleteScopeDocumentSchema,
  scopeDocumentUrlSchema,
  uploadScopeDocumentFieldsSchema,
} from "@/lib/validation/project-scope-documents";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("project-scope-documents validation", () => {
  it("AS: accepts a valid link submission (title + https URL)", () => {
    const result = createScopeDocumentLinkSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Figma proposal",
      url: "https://www.figma.com/file/abc123",
    });
    expect(result.success).toBe(true);
  });

  it("AS: rejects a link submission with an empty title", () => {
    const result = createScopeDocumentLinkSchema.safeParse({
      projectId: PROJECT_ID,
      title: "   ",
      url: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("AS: rejects a URL that doesn't start with http(s)://", () => {
    const result = scopeDocumentUrlSchema.safeParse("ftp://example.com/file");
    expect(result.success).toBe(false);
  });

  it("AS: rejects a URL that looks like a pasted credential", () => {
    const result = scopeDocumentUrlSchema.safeParse(
      "https://example.com?token=sk_live_abcdefghijklmno1234567890",
    );
    expect(result.success).toBe(false);
  });

  it("AS: accepts valid upload-field submission (title only — file validated separately)", () => {
    const result = uploadScopeDocumentFieldsSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Signed contract",
    });
    expect(result.success).toBe(true);
  });

  it("AS: rejects an upload-field submission with a missing title", () => {
    const result = uploadScopeDocumentFieldsSchema.safeParse({
      projectId: PROJECT_ID,
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("AS: rejects a delete request with a non-uuid document id", () => {
    const result = deleteScopeDocumentSchema.safeParse({ documentId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("AS: accepts a delete request with a valid uuid", () => {
    const result = deleteScopeDocumentSchema.safeParse({ documentId: PROJECT_ID });
    expect(result.success).toBe(true);
  });
});
