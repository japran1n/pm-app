// @vitest-environment jsdom
//
// F006e (missions/20260903-portal, AS-004): the task-detail route must
// show the task's own title in the topbar, not "Overview" and not the
// generic "Task" static fallback. That title only exists once
// `PortalTaskTitleAnnouncer` (rendered by the real Server Component page,
// `p/[projectId]/t/[taskId]/page.tsx`) mounts and announces it via
// `useSetPortalTitle` -- an effect, which `renderToStaticMarkup`
// (`portal-topbar.test.tsx`) never runs. This file mounts the real
// pieces with `@testing-library/react` + jsdom so the effect actually
// fires, the same technique `tests/unit/breadcrumb-context-no-loop.test.tsx`
// established for the sibling `useSetBreadcrumb` hook.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/portal/acme/p/proj-1/t/task-9";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { PortalTopbar } from "@/components/portal/portal-topbar";
import { PortalTitleProvider } from "@/components/portal/portal-title-context";
import { PortalTaskTitleAnnouncer } from "@/components/portal/portal-task-title-announcer";

afterEach(() => {
  cleanup();
});

const baseProps = {
  workspaceSlug: "acme",
  projectId: "proj-1",
  projectName: "Website redesign",
  targetLaunchDate: null as string | null,
  launchConfidence: null as "on_track" | "at_risk" | "slipped" | null,
};

describe("PortalTitleProvider + PortalTaskTitleAnnouncer (F006e)", () => {
  it("test_AS_004_the_task_detail_route_shows_the_tasks_own_title_in_the_topbar", () => {
    const { getByRole } = render(
      <PortalTitleProvider>
        <PortalTopbar {...baseProps} />
        <PortalTaskTitleAnnouncer title="Ship the launch banner" />
      </PortalTitleProvider>,
    );

    const heading = getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Ship the launch banner");
    expect(heading.textContent).not.toBe("Overview");
    expect(heading.textContent).not.toBe("Task");
  });

  it("test_AS_004_the_topbar_falls_back_to_the_route_title_when_nothing_announces_one", () => {
    mockPathname = "/portal/acme/p/proj-1/results";
    const { getByRole } = render(
      <PortalTitleProvider>
        <PortalTopbar {...baseProps} />
      </PortalTitleProvider>,
    );

    expect(getByRole("heading", { level: 1 }).textContent).toBe("Results");
  });

  it("test_AS_004_the_announced_title_clears_when_the_announcer_unmounts", () => {
    mockPathname = "/portal/acme/p/proj-1/t/task-9";
    const { getByRole, rerender } = render(
      <PortalTitleProvider>
        <PortalTopbar {...baseProps} />
        <PortalTaskTitleAnnouncer title="Ship the launch banner" />
      </PortalTitleProvider>,
    );
    expect(getByRole("heading", { level: 1 }).textContent).toBe(
      "Ship the launch banner",
    );

    // Simulate navigating away: the announcer unmounts, and the
    // remaining shell should not keep showing the last task's title.
    mockPathname = "/portal/acme/p/proj-1";
    rerender(
      <PortalTitleProvider>
        <PortalTopbar {...baseProps} />
      </PortalTitleProvider>,
    );

    expect(getByRole("heading", { level: 1 }).textContent).toBe("Overview");
  });
});
