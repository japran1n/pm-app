// Unit test for F113's client-side validation
// (docs/client-portal-phase-2-plan.md item B): `createPageLinkSchema`/
// `updatePageLinkSchema` (lib/validation/page-links.ts), and the same
// credential-shape guard now also applied to `project_links.url`
// (lib/validation/project-site.ts). The matching server-side halves are
// the CHECK constraints exercised live in
// tests/integration/f113-page-links-rls.test.ts.

import { describe, expect, it } from "vitest";
import { createPageLinkSchema, pageLinkKindSchema, updatePageLinkSchema } from "@/lib/validation/page-links";
import { createProjectLinkSchema } from "@/lib/validation/project-site";

const TASK_ID = "00000000-0000-4000-8000-000000000000";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const LINK_ID = "00000000-0000-4000-8000-000000000002";

describe("F113: createPageLinkSchema rejects a credential-shaped url with an actionable message", () => {
  it.each([
    "https://user:sk_live_51H8x9yzABCDEFGHIJ1234567890@staging.example.com",
    "https://staging.example.com/?token=ghp_1234567890abcdefghijklmnopqrstuv",
  ])("rejects %s", (url) => {
    const result = createPageLinkSchema.safeParse({
      taskId: TASK_ID,
      kind: "staging",
      label: "Staging",
      url,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/password manager/i);
    }
  });

  it("accepts an ordinary https URL", () => {
    const result = createPageLinkSchema.safeParse({
      taskId: TASK_ID,
      kind: "figma",
      label: "About — Figma frame",
      url: "https://www.figma.com/file/acme-about",
    });
    expect(result.success).toBe(true);
  });
});

describe("F113: updatePageLinkSchema shares the same url guard", () => {
  it("rejects a credential-shaped url on update", () => {
    const result = updatePageLinkSchema.safeParse({
      linkId: LINK_ID,
      kind: "staging",
      label: "Staging",
      url: "https://staging.example.com/#-----BEGIN PRIVATE KEY-----",
      clientVisible: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("F113: pageLinkKindSchema matches the vocabulary shared with project_links", () => {
  it("accepts every kind project_links accepts", () => {
    for (const kind of [
      "staging",
      "live",
      "figma",
      "sitemap",
      "drive",
      "webflow",
      "gtm",
      "analytics",
      "search_console",
      "other",
    ]) {
      expect(pageLinkKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects a kind outside the vocabulary", () => {
    expect(pageLinkKindSchema.safeParse("not_a_real_kind").success).toBe(false);
  });
});

// AS-113 (this feature's own): the audit's own gap -- project_links.url
// previously had no credential-shape guard at all. Extending the same
// refinement createPageLinkSchema uses.
describe("F113: createProjectLinkSchema now also rejects a credential-shaped url", () => {
  it("rejects a basic-auth-style credential in the url", () => {
    const result = createProjectLinkSchema.safeParse({
      projectId: PROJECT_ID,
      kind: "staging",
      label: "Staging",
      url: "https://user:sk_live_51H8x9yzABCDEFGHIJ1234567890@staging.example.com",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/password manager/i);
    }
  });

  it("still accepts an ordinary staging URL", () => {
    const result = createProjectLinkSchema.safeParse({
      projectId: PROJECT_ID,
      kind: "staging",
      label: "Staging",
      url: "https://staging.example.com",
    });
    expect(result.success).toBe(true);
  });
});
