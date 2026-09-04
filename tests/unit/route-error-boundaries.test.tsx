// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// F257 (AS-500): an error in one view does not blank the whole app shell.
// Verifies (1) every route-segment error.tsx and the root app/error.tsx
// render the shared, plain-language fallback rather than the raw thrown
// error, (2) the error's message/stack is never exposed to the user, and
// (3) the retry control actually invokes Next's `reset()` callback (which
// is what re-runs the failed render — that re-run itself is Next's
// responsibility, not this component's, so asserting `reset` was called
// is the correct boundary for a unit test).

import WorkspaceHomeError from "@/app/(workspace)/w/[workspaceSlug]/error";
import ArchiveError from "@/app/(workspace)/w/[workspaceSlug]/archive/error";
import CalendarError from "@/app/(workspace)/w/[workspaceSlug]/calendar/error";
import MyTasksError from "@/app/(workspace)/w/[workspaceSlug]/my-tasks/error";
import NotificationsError from "@/app/(workspace)/w/[workspaceSlug]/notifications/error";
import ProjectsError from "@/app/(workspace)/w/[workspaceSlug]/projects/error";
import ProjectBoardError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/error";
import ProjectListError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/error";
import ProjectSettingsError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/error";
import ProjectSettingsColumnsError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/error";
import SearchError from "@/app/(workspace)/w/[workspaceSlug]/search/error";
import WorkspaceSettingsError from "@/app/(workspace)/w/[workspaceSlug]/settings/error";
import AuditLogError from "@/app/(workspace)/w/[workspaceSlug]/settings/audit/error";
import MembersError from "@/app/(workspace)/w/[workspaceSlug]/settings/members/error";
import ProfileError from "@/app/(workspace)/w/[workspaceSlug]/settings/profile/error";
import TemplatesError from "@/app/(workspace)/w/[workspaceSlug]/templates/error";
import TimeReportError from "@/app/(workspace)/w/[workspaceSlug]/time/error";
import TimelineError from "@/app/(workspace)/w/[workspaceSlug]/timeline/error";
import TrashError from "@/app/(workspace)/w/[workspaceSlug]/trash/error";
import RootError from "@/app/error";

// F083: 12 routes (13 with the new settings/portal route, plus 2 more —
// t/[taskKey] and requests/preview-as-client — the audit found) had no
// error.tsx at all, so a query failure escaped to the ROOT boundary,
// destroying the sidebar. Added alongside every other route's
// error.tsx/loading.tsx pair.
import ProjectSettingsBudgetError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/budget/error";
import ProjectSettingsMeasurementError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/measurement/error";
import ProjectSettingsRecordError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/record/error";
import ProjectSettingsSiteError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/site/error";
import ProjectSettingsPortalError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/portal/error";
import ProjectHoursError from "@/app/(workspace)/w/[workspaceSlug]/projects/[projectId]/hours/error";
import RequestsError from "@/app/(workspace)/w/[workspaceSlug]/requests/error";
import PreviewAsClientError from "@/app/(workspace)/w/[workspaceSlug]/preview-as-client/error";
import SettingsTaskTypesError from "@/app/(workspace)/w/[workspaceSlug]/settings/task-types/error";
import SettingsStatusTemplatesError from "@/app/(workspace)/w/[workspaceSlug]/settings/status-templates/error";
import TaskByKeyError from "@/app/(workspace)/w/[workspaceSlug]/t/[taskKey]/error";
import DocsError from "@/app/(workspace)/w/[workspaceSlug]/docs/error";
import DocError from "@/app/(workspace)/w/[workspaceSlug]/docs/[docId]/error";
import ChatError from "@/app/(workspace)/w/[workspaceSlug]/chat/error";
import ChatChannelError from "@/app/(workspace)/w/[workspaceSlug]/chat/[channelId]/error";

afterEach(() => {
  cleanup();
});

const SECRET_MESSAGE = "SECRET_STACK_LEAK_shouldnt_be_visible_12345";

const routeErrorBoundaries: Array<{
  name: string;
  Component: (props: {
    error: Error & { digest?: string };
    reset: () => void;
  }) => React.ReactElement;
}> = [
  { name: "workspace home", Component: WorkspaceHomeError },
  { name: "archive", Component: ArchiveError },
  { name: "calendar", Component: CalendarError },
  { name: "my-tasks", Component: MyTasksError },
  { name: "notifications", Component: NotificationsError },
  { name: "projects list", Component: ProjectsError },
  { name: "project board", Component: ProjectBoardError },
  { name: "project list", Component: ProjectListError },
  { name: "project settings", Component: ProjectSettingsError },
  { name: "project settings columns", Component: ProjectSettingsColumnsError },
  { name: "search", Component: SearchError },
  { name: "workspace settings", Component: WorkspaceSettingsError },
  { name: "settings audit log", Component: AuditLogError },
  { name: "settings members", Component: MembersError },
  { name: "settings profile", Component: ProfileError },
  { name: "templates", Component: TemplatesError },
  { name: "time report", Component: TimeReportError },
  { name: "timeline", Component: TimelineError },
  { name: "trash", Component: TrashError },
  { name: "root app shell (app/error.tsx)", Component: RootError },
  // F083 additions:
  { name: "project settings budget", Component: ProjectSettingsBudgetError },
  { name: "project settings measurement", Component: ProjectSettingsMeasurementError },
  { name: "project settings record", Component: ProjectSettingsRecordError },
  { name: "project settings site", Component: ProjectSettingsSiteError },
  { name: "project settings portal", Component: ProjectSettingsPortalError },
  { name: "project hours", Component: ProjectHoursError },
  { name: "requests", Component: RequestsError },
  { name: "preview as client", Component: PreviewAsClientError },
  { name: "settings task types", Component: SettingsTaskTypesError },
  { name: "settings status templates", Component: SettingsStatusTemplatesError },
  { name: "task by key", Component: TaskByKeyError },
  { name: "docs", Component: DocsError },
  { name: "doc", Component: DocError },
  { name: "chat", Component: ChatError },
  { name: "chat channel", Component: ChatChannelError },
];

describe("AS-500: route error boundaries never blank the app shell", () => {
  for (const { name, Component } of routeErrorBoundaries) {
    it(`test_AS_500_${name.replace(/\W+/g, "_")}_renders_plain_language_fallback_without_leaking_error_message`, () => {
      // Suppress the intentional console.error the component logs (see
      // components/route-error.tsx's file header for why it logs at all).
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const reset = vi.fn();
      const error = Object.assign(new Error(SECRET_MESSAGE), {
        stack: `Error: ${SECRET_MESSAGE}\n    at someInternalFunction (secret/path.ts:42:1)`,
      });

      render(<Component error={error} reset={reset} />);

      // Plain-language message is visible.
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      // A retry control exists.
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
      // The raw error message/stack is never rendered to the user.
      expect(document.body.textContent).not.toContain(SECRET_MESSAGE);
      expect(document.body.textContent).not.toContain("someInternalFunction");

      consoleSpy.mockRestore();
    });
  }

  it("test_AS_500_retry_button_invokes_nexts_reset_callback_to_re_run_the_failed_render", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = new Error("boom");

    render(<ArchiveError error={error} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Next.js's `reset()` — not a local re-render of the same failed
    // state — is what actually re-invokes the failed Server Component, so
    // the retry control must call the `reset` prop it was handed, not
    // manage its own local "retry" state.
    expect(reset).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it("test_AS_500_error_boundary_does_not_render_sidebar_itself_leaving_that_to_the_parent_layout", () => {
    // The workspace shell (sidebar/nav) lives in
    // app/(workspace)/w/[workspaceSlug]/layout.tsx, which sits ABOVE every
    // error.tsx boundary in the tree and is therefore never re-rendered or
    // replaced when a segment throws — Next mounts error.tsx in place of
    // only the failing segment's children. This test documents that the
    // error boundary component itself renders no sidebar/nav markup of
    // its own (it would be redundant and wrong for it to), i.e. it relies
    // entirely on the parent layout staying mounted rather than trying to
    // recreate the shell.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ArchiveError error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
