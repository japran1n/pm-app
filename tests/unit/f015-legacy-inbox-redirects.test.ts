import { describe, it, expect, vi } from "vitest";

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

// F053 (FU-M4-6): replaces the old readFileSync/toContain source-text
// grep with a genuinely behavioural check — mock `next/navigation`'s
// `permanentRedirect` to throw (the same "redirect() actually throws"
// technique already used by tests/unit/f009-legacy-portal-route-
// redirects.test.ts), invoke each legacy route page's default export
// (a real async Server Component function) with a slug + search params,
// and assert it actually calls permanentRedirect with the exact mapped
// Inbox URL. This is non-vacuous: if the page stopped calling
// permanentRedirect, or called it with the wrong URL, or ever returned
// normally instead of throwing, these assertions fail — a source-text
// grep for the string "permanentRedirect(" could still pass with dead
// code that never executes it.
const { permanentRedirectMock } = vi.hoisted(() => ({
  permanentRedirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({
  permanentRedirect: permanentRedirectMock,
}));

describe("legacy standalone route pages redirect (SB-056)", () => {
  const routes: Array<{
    file: string;
    tab: string;
    importPath: string;
  }> = [
    {
      file: "approvals",
      tab: "approvals",
      importPath: "@/app/(workspace)/w/[workspaceSlug]/approvals/page",
    },
    {
      file: "requests",
      tab: "requests",
      importPath: "@/app/(workspace)/w/[workspaceSlug]/requests/page",
    },
    {
      file: "watching",
      tab: "watching",
      importPath: "@/app/(workspace)/w/[workspaceSlug]/watching/page",
    },
    {
      file: "notifications",
      tab: "notifications",
      importPath: "@/app/(workspace)/w/[workspaceSlug]/notifications/page",
    },
  ];

  for (const { file, tab, importPath } of routes) {
    it(`${file}/page.tsx redirects to /w/acme/inbox?tab=${tab}`, async () => {
      vi.resetModules();
      const { default: RedirectPage } = await import(importPath);

      await expect(
        RedirectPage({
          params: Promise.resolve({ workspaceSlug: "acme" }),
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toThrow(`NEXT_REDIRECT:/w/acme/inbox?tab=${tab}`);
    });

    it(`${file}/page.tsx preserves extra search params in the redirect`, async () => {
      vi.resetModules();
      const { default: RedirectPage } = await import(importPath);

      await expect(
        RedirectPage({
          params: Promise.resolve({ workspaceSlug: "acme" }),
          searchParams: Promise.resolve({ highlight: "123" }),
        }),
      ).rejects.toThrow(
        `NEXT_REDIRECT:/w/acme/inbox?tab=${tab}&highlight=123`,
      );
    });
  }
});
