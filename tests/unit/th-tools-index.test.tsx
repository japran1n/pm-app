// @vitest-environment jsdom
//
// F014 (TH-037..TH-042): integration tests for the tools index route
// (app/(workspace)/w/[workspaceSlug]/tools/page.tsx). ToolsIndexPage is an
// async Server Component, so we await it directly to get the JSX it
// produces (the standard pattern for testing RSC output with
// @testing-library/react) rather than trying to `render()` an async
// component directly, which @testing-library/react does not support.

import fs from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import ToolsIndexPage from "@/app/(workspace)/w/[workspaceSlug]/tools/page";

afterEach(() => {
  cleanup();
});

const PAGE_SOURCE_PATH = path.join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/tools/page.tsx"
);

async function renderToolsPage() {
  const element = await ToolsIndexPage({
    params: Promise.resolve({ workspaceSlug: "acme" }),
  });
  render(element);
}

describe("Tools index page (TH-037..TH-042)", () => {
  it("TH-037: renders a ToolCard for each tool entry", async () => {
    await renderToolsPage();

    // Two known tools from the sidebar's "Tools" band: HTML -> Webflow and
    // Webflow Code Editor. Each renders as a link (ToolCard is a Link).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("TH-038: navigation to /tools/code-editor works", async () => {
    await renderToolsPage();

    const link = screen.getByRole("link", { name: /webflow code editor/i });
    expect(link).toHaveAttribute("href", "/w/acme/tools/code-editor");
  });

  it("TH-039: navigation to /tools/webflow works", async () => {
    await renderToolsPage();

    const link = screen.getByRole("link", { name: /html.*webflow/i });
    expect(link).toHaveAttribute("href", "/w/acme/tools/webflow");
  });

  it("TH-040: tools page has a proper title/heading", async () => {
    await renderToolsPage();

    const heading = screen.getByRole("heading", { name: "Tools" });
    expect(heading).toBeInTheDocument();
  });

  it("TH-041: tool cards display name and description", async () => {
    await renderToolsPage();

    expect(screen.getByText("HTML → Webflow")).toBeInTheDocument();
    expect(
      screen.getByText("Convert exported HTML into Webflow-ready markup.")
    ).toBeInTheDocument();

    expect(screen.getByText("Webflow Code Editor")).toBeInTheDocument();
    expect(
      screen.getByText("Edit and preview Webflow custom code snippets.")
    ).toBeInTheDocument();
  });

  it("TH-042: tools page is a server component (no 'use client' directive)", () => {
    const source = fs.readFileSync(PAGE_SOURCE_PATH, "utf8");
    expect(source).not.toMatch(/^\s*["']use client["'];?\s*$/m);
  });
});
