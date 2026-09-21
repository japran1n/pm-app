import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/brief", () => ({ generateBriefDocument: vi.fn() }));

import { BriefHeader } from "@/components/brief/brief-header";
import { GenerateDocumentButton } from "@/components/brief/generate-document-button";

const PAGE =
  "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx";
const base = {
  answeredCount: 1,
  totalCount: 2,
  requiredMissingCount: 1,
  lastModifiedBy: "Ada",
  lastModifiedAt: "2026-03-05T10:00:00Z",
};

describe("brief actions in header", () => {
  it("test_BR_023_actions_render_inside_header_element", () => {
    const out = renderToStaticMarkup(
      createElement(BriefHeader, {
        ...base,
        actions: createElement("button", null, "Do it"),
      }),
    );
    expect(out).toMatch(
      /<header[\s\S]*data-testid="brief-header-actions"[\s\S]*Do it[\s\S]*<\/header>/,
    );
  });

  it("test_BR_023_no_actions_row_when_none_and_page_has_no_floating_block", () => {
    const out = renderToStaticMarkup(createElement(BriefHeader, base));
    expect(out).not.toContain("brief-header-actions");
    const src = readFileSync(PAGE, "utf8");
    expect(src).not.toContain("mb-4 flex items-center justify-end");
    expect(src).toMatch(/actions=\{/);
  });

  it("test_BR_025_meta_renders_in_meta_line", () => {
    const out = renderToStaticMarkup(
      createElement(BriefHeader, {
        ...base,
        meta: createElement("span", null, "Notifies: Bo"),
      }),
    );
    expect(out).toMatch(/Last updated by[\s\S]*Notifies: Bo/);
    const src = readFileSync(PAGE, "utf8");
    expect(src).toMatch(/meta=\{\s*<NotificationRecipientsPointer/);
  });

  it("test_BR_024_generate_disabled_with_reason_when_disabled", () => {
    const out = renderToStaticMarkup(
      createElement(GenerateDocumentButton, {
        workspaceSlug: "w",
        projectId: "p",
        briefId: "b",
        disabled: true,
      }),
    );
    expect(out).toContain("generate-document-disabled-trigger");
    expect(out).toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
    expect(out).toContain("Generate Document");
  });

  it("test_BR_024_generate_enabled_when_not_disabled", () => {
    const out = renderToStaticMarkup(
      createElement(GenerateDocumentButton, {
        workspaceSlug: "w",
        projectId: "p",
        briefId: "b",
      }),
    );
    expect(out).not.toContain("generate-document-disabled-trigger");
    expect(out).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });

  it("test_BR_026_approval_conditions_unchanged_in_page", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toContain('brief.state !== "approved"');
    expect(src).toMatch(/<RequestApprovalButton/);
    expect(src).toMatch(/<ApproveBriefButton briefId=\{brief.id\} \/>/);
    expect(src).toMatch(/<WithdrawApprovalButton briefId=\{brief.id\} \/>/);
    expect(src).toContain("disabled={requiredMissingCount > 0}");
  });
});
