// @vitest-environment jsdom
//
// F009 (missions/20260903-portal, AS-021, AS-022, AS-023): component
// tests for `ApprovalCard`, the F007/F008-shaped `approval_requests` card
// that supersedes `approval-actions.tsx`'s task-boolean approve/reject
// pair for this feature's own surface (see that component's own header
// comment for why it stays alongside this one rather than being deleted
// -- the task detail page's legacy `pending_client_approval` toggle flow
// is untouched by this feature's file list). Same mocked-server-action +
// fake-router shape as approval-actions.test.tsx.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const {
  toastErrorMock,
  toastSuccessMock,
  decideMock,
  refreshMock,
  getSnapshotUrlMock,
  nudgeOwnerMock,
} = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  decideMock: vi.fn(),
  refreshMock: vi.fn(),
  getSnapshotUrlMock: vi.fn(),
  nudgeOwnerMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/portal-approval", () => ({
  decideApproval: decideMock,
  nudgeApprovalOwner: nudgeOwnerMock,
}));

vi.mock("@/lib/actions/approvals", () => ({
  getApprovalDocSnapshotUrl: getSnapshotUrlMock,
}));

import { ApprovalCard } from "./approval-card";
import type { PortalApproval } from "@/lib/queries/approvals";

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  decideMock.mockReset();
  refreshMock.mockReset();
  getSnapshotUrlMock.mockReset();
  nudgeOwnerMock.mockReset();
});

function todayIsoForTest(): string {
  return new Date().toISOString().slice(0, 10);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const APPROVAL: PortalApproval = {
  id: "req-1",
  projectId: "project-1",
  title: "Homepage copy",
  description: "Final copy for the homepage hero.",
  decisionType: "brand",
  subjectType: "artifact",
  subjectId: null,
  artifactUrl: "https://figma.com/file/abc",
  artifactSnapshotPath: null,
  state: "pending",
  requestedAt: "2026-08-01T00:00:00Z",
  dueAt: "2026-09-01",
  decidedAt: null,
  decisionNote: null,
  decidedBy: null,
  round: 1,
};

function renderCard(overrides: Partial<Parameters<typeof ApprovalCard>[0]> = {}) {
  return render(
    createElement(ApprovalCard, {
      approval: APPROVAL,
      workspaceSlug: "acme",
      projectId: "project-1",
      isOwner: true,
      ownerName: "Jane Doe",
      ...overrides,
    }),
  );
}

describe("ApprovalCard (F009)", () => {
  it("test_AS_022_non_owner_sees_disabled_buttons_naming_who_decides", () => {
    renderCard({ isOwner: false, ownerName: "Jane Doe" });

    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /request changes/i })).toBeDisabled();
    expect(screen.getByText(/only jane doe can decide this/i)).toBeInTheDocument();
    // Presentation only -- decideApproval is never even attempted from a
    // disabled control; the real enforcement (AS-022) lives in the RPC,
    // not asserted by this component test.
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("test_AS_022_no_owner_assigned_says_so_plainly", () => {
    renderCard({ isOwner: false, ownerName: null });

    expect(screen.getByText(/no one is assigned to decide this yet/i)).toBeInTheDocument();
  });

  it("test_AS_023_approve_applies_optimistically_before_the_action_resolves", async () => {
    const { promise, resolve } = deferred<{
      ok: true;
      data: { requestId: string; state: string; decidedAt: string };
    }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(decideMock).toHaveBeenCalledWith("req-1", "approved", null);

    resolve({ ok: true, data: { requestId: "req-1", state: "approved", decidedAt: "2026-09-01T00:00:00Z" } });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // The card settles IN PLACE on success -- it is never removed from the
  // list, so a client cannot mistake success for a crash (this feature's
  // own explicit instruction).
  it("test_AS_023_settled_card_stays_on_the_page_after_success", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: { requestId: "req-1", state: "approved", decidedAt: "2026-09-01T00:00:00Z" },
    });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByTestId("approval-card")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(screen.getByTestId("approval-card")).toBeInTheDocument();
  });

  it("test_AS_023_approve_reverts_and_toasts_on_ok_false", async () => {
    const { promise, resolve } = deferred<{ ok: false; error: string }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());

    resolve({ ok: false, error: "you are not the decision owner for this request" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("you are not the decision owner for this request");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("test_AS_023_approve_reverts_and_toasts_on_throw", async () => {
    const { promise, reject } = deferred<never>();
    decideMock.mockReturnValue(promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());

    reject(new Error("network down"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument(),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Something went wrong. Please try again in a moment.",
    );
  });

  it("test_AS_015_second_synchronous_approve_click_issues_no_second_call", async () => {
    const { promise } = deferred<{
      ok: true;
      data: { requestId: string; state: string; decidedAt: string };
    }>();
    decideMock.mockReturnValue(promise);

    renderCard();

    const button = screen.getByRole("button", { name: /approve/i });
    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => expect(screen.getByText(/^approved on/i)).toBeInTheDocument());
    expect(decideMock).toHaveBeenCalledTimes(1);
  });

  it("test_AS_023_request_changes_requires_a_note_before_sending", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    const sendButton = screen.getByRole("button", { name: /^send$/i });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "   " },
    });
    fireEvent.click(sendButton);

    expect(decideMock).not.toHaveBeenCalled();
  });

  it("test_AS_023_request_changes_settles_with_the_note", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: {
        requestId: "req-1",
        state: "changes_requested",
        decidedAt: "2026-09-01T00:00:00Z",
        resultingTaskId: "task-created-1",
      },
    });

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith("req-1", "changes_requested", "please fix the header"),
    );
    await waitFor(() => expect(screen.getByText(/changes requested on/i)).toBeInTheDocument());
  });

  // F011 (AS-025): the settled card names the task the decision created,
  // without ever forming a link to it (the resulting task is never
  // client_visible by default -- see decide_approval_atomic's own
  // migration comment).
  it("test_AS_025_settled_card_names_the_task_that_was_created_without_linking_to_it", async () => {
    decideMock.mockResolvedValue({
      ok: true,
      data: {
        requestId: "req-1",
        state: "changes_requested",
        decidedAt: "2026-09-01T00:00:00Z",
        resultingTaskId: "task-created-1",
      },
    });

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what you'd like changed/i), {
      target: { value: "please fix the header" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const loggedLine = await screen.findByText(/we.ve logged this as work for the team/i);
    expect(loggedLine).toBeInTheDocument();
    // Never a link -- a client-created task is not client_visible by
    // default, so this line is deliberately text, not an <a>.
    expect(loggedLine.closest("a")).toBeNull();
  });

  // F085 (missions/20260903-portal audit, defect 6): `requestedAt` and
  // `round` were fetched and never shown -- a client couldn't tell a
  // fresh ask from a three-week-old one, or a first round from a
  // re-submission.
  it("test_AS_085_shows_when_the_request_was_raised", () => {
    renderCard({ approval: { ...APPROVAL, requestedAt: "2026-08-01T00:00:00Z", round: 1 } });

    const meta = screen.getByTestId("approval-requested-meta");
    expect(meta).toHaveTextContent("Requested 1 Aug");
    // Round 1 is not a re-submission -- no round number shown for it.
    expect(meta).not.toHaveTextContent("Round");
  });

  it("test_AS_085_shows_the_round_number_for_a_re_submission", () => {
    renderCard({ approval: { ...APPROVAL, requestedAt: "2026-08-15T00:00:00Z", round: 2 } });

    const meta = screen.getByTestId("approval-requested-meta");
    expect(meta).toHaveTextContent("Requested 15 Aug");
    expect(meta).toHaveTextContent("Round 2");
  });

  // F085 (defect 6): a non-owner used to get a dead-end "Only X can
  // decide this." with nothing to do next. F090 item 3: this used to be
  // a `mailto:` link (lib/notifications/** was locked at the time) --
  // now a real in-app notification via `nudgeApprovalOwner`.
  it("test_AS_085_non_owner_can_ask_the_named_owner_to_look", async () => {
    nudgeOwnerMock.mockResolvedValue({ ok: true });
    renderCard({ isOwner: false, ownerName: "Jane Doe", ownerId: "user-jane" });

    const button = screen.getByTestId("nudge-owner-button");
    expect(button).toHaveTextContent(/ask jane doe to take a look/i);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(nudgeOwnerMock).toHaveBeenCalledWith(APPROVAL.id);
    });
    // Never calls a mailto: navigation -- the action is the only side
    // effect.
    expect(screen.queryByRole("link", { name: /ask jane doe to take a look/i })).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("nudge-owner-sent")).toHaveTextContent(/jane doe was notified/i);
    });
  });

  it("test_AS_085_nudge_failure_shows_an_error_and_stays_retryable", async () => {
    nudgeOwnerMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    renderCard({ isOwner: false, ownerName: "Jane Doe", ownerId: "user-jane" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("nudge-owner-button"));
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Something went wrong.");
    });
    expect(screen.getByTestId("nudge-owner-button")).toBeInTheDocument();
    expect(screen.queryByTestId("nudge-owner-sent")).toBeNull();
  });

  it("test_AS_085_unassigned_case_points_at_who_to_raise_it_with", () => {
    renderCard({ isOwner: false, ownerName: null });

    expect(
      screen.getByRole("link", { name: /see who to raise it with/i }),
    ).toHaveAttribute("href", "/portal/acme/p/project-1/for-you?filter=decisions");
  });

  // F110 (missions/20260903-portal, plan section 3.5): the age bar's
  // three honest cases -- overdue must read as past due (not a "full"
  // bar indistinguishable from on-time), no due date must not fabricate
  // a scale, and "raised today" must not divide by zero or show a
  // negative/garbage day count.
  describe("age bar (F110)", () => {
    it("test_age_bar_overdue_shows_overdue_text_and_icon_not_colour_alone", () => {
      renderCard({
        approval: { ...APPROVAL, requestedAt: "2026-08-01T00:00:00Z", dueAt: "2020-01-01" },
      });

      const fill = screen.getByTestId("approval-age-bar-fill");
      expect(fill).toHaveAttribute("data-overdue", "true");
      // The overdue state must be nameable without colour: a visible
      // text line plus icon, not just the fill's colour token.
      const ageBlock = screen.getByTestId("approval-age");
      expect(ageBlock).toHaveTextContent(/overdue/i);
    });

    it("test_age_bar_no_due_date_renders_days_waited_with_no_bar", () => {
      renderCard({ approval: { ...APPROVAL, requestedAt: "2026-08-01T00:00:00Z", dueAt: null } });

      const ageBlock = screen.getByTestId("approval-age");
      expect(ageBlock).toHaveTextContent(/waiting/i);
      expect(screen.queryByTestId("approval-age-bar")).not.toBeInTheDocument();
    });

    it("test_age_bar_raised_today_shows_zero_days_with_no_error", () => {
      const today = todayIsoForTest();
      renderCard({
        approval: { ...APPROVAL, requestedAt: `${today}T00:00:00Z`, dueAt: null },
      });

      expect(screen.getByTestId("approval-age")).toHaveTextContent(/raised today/i);
    });

    it("test_age_bar_on_time_fill_is_not_overdue_and_bar_is_present", () => {
      const today = todayIsoForTest();
      const dueAt = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      renderCard({
        approval: { ...APPROVAL, requestedAt: `${today}T00:00:00Z`, dueAt },
      });

      const fill = screen.getByTestId("approval-age-bar-fill");
      expect(fill).toHaveAttribute("data-overdue", "false");
      expect(screen.getByTestId("approval-age-bar")).toBeInTheDocument();
    });
  });

  it("shows an overdue due chip when the due date has passed and the card is still pending", () => {
    renderCard({ approval: { ...APPROVAL, dueAt: "2020-01-01" } });

    const chip = screen.getByTestId("approval-due-chip");
    expect(chip).toHaveAttribute("data-overdue", "true");
    expect(chip).toHaveTextContent(/overdue/i);
  });

  // F079 (missions/20260903-portal audit, defect 3): `dueAt` is a
  // date-only value (see approval-card.tsx's own `formatDate` comment).
  // Rendered without pinning to UTC, a client west of UTC (this test
  // simulates New York, UTC-4/-5) sees the day BEFORE the real due date
  // -- "31 Aug" instead of "1 Sep" for a request due 2026-09-01.
  describe("due chip date — F079 defect 3 (UTC pin)", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("test_due_chip_shows_the_real_due_date_for_a_client_west_of_utc", () => {
      process.env.TZ = "America/New_York";
      renderCard({ approval: { ...APPROVAL, dueAt: "2099-09-01" } });

      const chip = screen.getByTestId("approval-due-chip");
      expect(chip).toHaveTextContent("1 Sep");
      expect(chip).not.toHaveTextContent("31 Aug");
    });
  });

  // F009c (AS-021): a doc-subject approval has no artifact_url and no
  // task subject to link into -- before this fix it rendered no "Open"
  // control at all. It must now open the stored snapshot via a freshly
  // minted signed URL, same click-to-open shape as
  // components/portal/file-list.tsx.
  describe("doc-subject snapshot open control (F009c, AS-021)", () => {
    const DOC_APPROVAL: PortalApproval = {
      ...APPROVAL,
      subjectType: "doc",
      subjectId: "doc-1",
      artifactUrl: null,
      artifactSnapshotPath: "approval-requests/req-1/doc-snapshot.md",
    };

    it("test_AS_021_doc_approval_renders_an_open_control", () => {
      renderCard({ approval: DOC_APPROVAL });

      expect(screen.getByRole("button", { name: /open/i })).toBeInTheDocument();
    });

    it("test_AS_021_opening_a_doc_approval_mints_a_signed_url_and_opens_it", async () => {
      getSnapshotUrlMock.mockResolvedValue({
        ok: true,
        signedUrl: "https://storage.example.com/signed/doc-snapshot.md",
      });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      renderCard({ approval: DOC_APPROVAL });
      fireEvent.click(screen.getByRole("button", { name: /open/i }));

      await waitFor(() => expect(getSnapshotUrlMock).toHaveBeenCalledWith("req-1"));
      await waitFor(() =>
        expect(openSpy).toHaveBeenCalledWith(
          "https://storage.example.com/signed/doc-snapshot.md",
          "_blank",
          "noopener,noreferrer",
        ),
      );

      openSpy.mockRestore();
    });

    it("test_AS_021_doc_approval_open_failure_toasts_and_does_not_open_a_window", async () => {
      getSnapshotUrlMock.mockResolvedValue({ ok: false, error: "Approval request not found." });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      renderCard({ approval: DOC_APPROVAL });
      fireEvent.click(screen.getByRole("button", { name: /open/i }));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith("Approval request not found."),
      );
      expect(openSpy).not.toHaveBeenCalled();

      openSpy.mockRestore();
    });

    it("test_AS_021_doc_approval_with_no_snapshot_path_renders_no_open_control", () => {
      renderCard({ approval: { ...DOC_APPROVAL, artifactSnapshotPath: null } });

      expect(screen.queryByRole("button", { name: /open/i })).not.toBeInTheDocument();
    });
  });
});
