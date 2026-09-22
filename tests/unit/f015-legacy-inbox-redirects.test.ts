import { describe, it, expect } from "vitest";

import { legacyInboxRedirectPath } from "@/lib/inbox/legacy-redirect";

// F015 (SB-056): the four old standalone routes (approvals/requests/
// watching/notifications) now only redirect to the canonical Inbox tab
// URL. This tests the pure mapping function directly (no rendering, no
// Next.js request context needed for the mapping logic itself).
describe("legacyInboxRedirectPath (SB-056)", () => {
  it("maps /approvals to inbox?tab=approvals", () => {
    expect(legacyInboxRedirectPath("acme", "approvals")).toBe(
      "/w/acme/inbox?tab=approvals",
    );
  });

  it("maps /requests to inbox?tab=requests", () => {
    expect(legacyInboxRedirectPath("acme", "requests")).toBe(
      "/w/acme/inbox?tab=requests",
    );
  });

  it("maps /watching to inbox?tab=watching", () => {
    expect(legacyInboxRedirectPath("acme", "watching")).toBe(
      "/w/acme/inbox?tab=watching",
    );
  });

  it("maps /notifications to inbox?tab=notifications", () => {
    expect(legacyInboxRedirectPath("acme", "notifications")).toBe(
      "/w/acme/inbox?tab=notifications",
    );
  });

  it("preserves extra search params from the old URL", () => {
    expect(
      legacyInboxRedirectPath("acme", "approvals", { highlight: "123" }),
    ).toBe("/w/acme/inbox?tab=approvals&highlight=123");
  });

  it("does not let an incoming `tab` param override the mapped tab", () => {
    expect(
      legacyInboxRedirectPath("acme", "watching", { tab: "requests" }),
    ).toBe("/w/acme/inbox?tab=watching");
  });

  it("drops undefined search param values", () => {
    expect(
      legacyInboxRedirectPath("acme", "notifications", { foo: undefined }),
    ).toBe("/w/acme/inbox?tab=notifications");
  });
});

describe("legacy standalone route pages redirect (SB-056)", () => {
  // Fail-without-fix check: proves each page module actually calls
  // permanentRedirect with the mapped Inbox URL, not just that the pure
  // helper above works in isolation. Reading the source directly (rather
  // than rendering, which would require full Next.js server-component
  // request context) keeps this fast and dependency-free, same technique
  // already used elsewhere in this suite (e.g. f078-discovery-approvals).
  const routes: Array<{ file: string; tab: string }> = [
    { file: "approvals", tab: "approvals" },
    { file: "requests", tab: "requests" },
    { file: "watching", tab: "watching" },
    { file: "notifications", tab: "notifications" },
  ];

  for (const { file, tab } of routes) {
    it(`${file}/page.tsx calls permanentRedirect via legacyInboxRedirectPath("${tab}")`, async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const source = readFileSync(
        join(
          process.cwd(),
          `app/(workspace)/w/[workspaceSlug]/${file}/page.tsx`,
        ),
        "utf8",
      );
      expect(source).toContain("permanentRedirect(");
      expect(source).toContain(`"${tab}"`);
      expect(source).not.toMatch(/^\s*export default async function \w+Page[\s\S]*return \(/m);
    });
  }
});
