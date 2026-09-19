// @vitest-environment jsdom
//
// F013 (TH-030, TH-031, TH-032, TH-033, TH-036): the "Tools" index route at
// app/(workspace)/w/[workspaceSlug]/tools/page.tsx.
//
// TH-036 ("no Supabase query beyond the shared layout's access check") is
// verified the same way F002's converter-route-skeleton test verifies its
// own zero-Supabase-query assertion: a static source check that this page
// imports no Supabase client and performs no auth/membership check of its
// own, proving it relies entirely on the shared layout guard (which itself
// redirects an unauthenticated visitor to /sign-in, and 404s a non-member)
// rather than duplicating it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

const PAGE_PATH = join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/tools/page.tsx",
);

afterEach(() => {
  cleanup();
});

describe("ToolsIndexPage (F013)", () => {
  it("TH-036: the page performs no Supabase query or auth/membership check of its own", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/supabase/);
    expect(source).not.toMatch(/createAdminClient|\.from\(/);
    expect(source).not.toMatch(/getCurrentUser|redirect\(|notFound\(/);
  });

  it("TH-030: renders a 'Tools' page listing the available tools", async () => {
    const { default: ToolsIndexPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/tools/page"
    );

    const jsx = await ToolsIndexPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
    });
    render(jsx);

    expect(screen.getByRole("heading", { name: /^Tools$/ })).toBeInTheDocument();
  });

  it("TH-031 / TH-033: a card for the HTML → Webflow converter renders with name + description, linking to the converter route", async () => {
    const { default: ToolsIndexPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/tools/page"
    );

    const jsx = await ToolsIndexPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
    });
    render(jsx);

    const link = screen.getByRole("link", { name: /HTML → Webflow/ });
    expect(link).toHaveAttribute("href", "/w/acme/tools/webflow");
    expect(link.textContent).toMatch(/convert/i);
  });

  it("TH-032 / TH-033: a card for the Webflow Code Editor renders with name + description, linking to the code editor route", async () => {
    const { default: ToolsIndexPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/tools/page"
    );

    const jsx = await ToolsIndexPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
    });
    render(jsx);

    const link = screen.getByRole("link", { name: /Webflow Code Editor/ });
    expect(link).toHaveAttribute("href", "/w/acme/tools/code-editor");
    expect(link.textContent).toMatch(/edit/i);
  });

  it("TH-033: both tool cards are present simultaneously and use the workspace slug from params, not a hardcoded one", async () => {
    const { default: ToolsIndexPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/tools/page"
    );

    const jsx = await ToolsIndexPage({
      params: Promise.resolve({ workspaceSlug: "globex" }),
    });
    render(jsx);

    expect(
      screen.getByRole("link", { name: /HTML → Webflow/ }),
    ).toHaveAttribute("href", "/w/globex/tools/webflow");
    expect(
      screen.getByRole("link", { name: /Webflow Code Editor/ }),
    ).toHaveAttribute("href", "/w/globex/tools/code-editor");
  });
});
