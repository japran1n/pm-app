// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
vi.mock("@/lib/actions/brief", () => ({
  generateBriefDocument: vi.fn(),
  approveBrief: vi.fn(),
  requestBriefApproval: vi.fn(),
  withdrawBriefApproval: vi.fn(),
}));

import { BriefHeader } from "@/components/brief/brief-header";
import { GenerateDocumentButton } from "@/components/brief/generate-document-button";
import { ApproveBriefButton } from "@/components/brief/approve-brief-button";
import { RequestApprovalButton } from "@/components/brief/request-approval-button";
import { WithdrawApprovalButton } from "@/components/brief/withdraw-approval-button";
import {
  approveBrief,
  requestBriefApproval,
  withdrawBriefApproval,
} from "@/lib/actions/brief";

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

  it("test_BR_024_disabled_trigger_has_accessible_name_with_reason", () => {
    const out = renderToStaticMarkup(
      createElement(GenerateDocumentButton, {
        workspaceSlug: "w",
        projectId: "p",
        briefId: "b",
        disabled: true,
        disabledReason: "Answer all required questions first",
      }),
    );
    const trigger = out.match(/<span[^>]*generate-document-disabled-trigger[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain('aria-disabled="true"');
    expect(trigger).toMatch(/aria-label="[^"]*Answer all required questions first[^"]*"/);
  });

  it("test_BR_006_page_does_not_offer_generate_when_docs_lookup_errors", () => {
    const src = readFileSync(
      "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx",
      "utf8",
    );
    expect(src).toMatch(/error: existingDocError/);
    expect(src).toMatch(/documentLookupFailed\s*\?/);
    expect(src.indexOf("documentLookupFailed ?")).toBeLessThan(src.indexOf("<GenerateDocumentButton"));
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

  it("test_BR_026_page_keeps_state_gate_and_required_missing_disable", () => {
    // Minimal structural check: the page-level conditional cannot be
    // rendered cheaply (server component with data loading).
    const src = readFileSync(PAGE, "utf8");
    expect(src).toContain('brief.state !== "approved"');
    expect(src).toContain("disabled={requiredMissingCount > 0}");
  });
});

describe("BR-026 approval buttons behave unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("test_BR_026_approve_click_calls_action_with_brief_id_and_refreshes", async () => {
    vi.mocked(approveBrief).mockResolvedValue({ success: true } as never);
    render(createElement(ApproveBriefButton, { briefId: "b1" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(approveBrief).toHaveBeenCalledTimes(1);
    expect(approveBrief).toHaveBeenCalledWith("b1");
  });

  it("test_BR_026_approve_failure_shows_error_and_does_not_refresh", async () => {
    vi.mocked(approveBrief).mockResolvedValue({
      success: false,
      error: "Nope",
    } as never);
    render(createElement(ApproveBriefButton, { briefId: "b1" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Nope")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("test_BR_026_request_click_calls_action_with_project_and_document", async () => {
    vi.mocked(requestBriefApproval).mockResolvedValue({ success: true } as never);
    render(
      createElement(RequestApprovalButton, { projectId: "p1", documentId: "d1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    const done = await screen.findByRole("button", { name: "Approval requested" });
    expect(done.hasAttribute("disabled")).toBe(true);
    expect(requestBriefApproval).toHaveBeenCalledWith("p1", "d1");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("test_BR_026_request_failure_shows_error_and_stays_clickable", async () => {
    vi.mocked(requestBriefApproval).mockResolvedValue({
      success: false,
      error: "Denied",
    } as never);
    render(
      createElement(RequestApprovalButton, { projectId: "p1", documentId: "d1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    expect(await screen.findByText("Denied")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Request approval" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("test_BR_026_withdraw_click_calls_action_with_brief_id_and_refreshes", async () => {
    vi.mocked(withdrawBriefApproval).mockResolvedValue({ success: true } as never);
    render(createElement(WithdrawApprovalButton, { briefId: "b2" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw approval" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(withdrawBriefApproval).toHaveBeenCalledWith("b2");
  });

  it("test_BR_026_withdraw_failure_shows_error_and_does_not_refresh", async () => {
    vi.mocked(withdrawBriefApproval).mockResolvedValue({
      success: false,
      error: "Locked",
    } as never);
    render(createElement(WithdrawApprovalButton, { briefId: "b2" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw approval" }));
    expect(await screen.findByText("Locked")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
