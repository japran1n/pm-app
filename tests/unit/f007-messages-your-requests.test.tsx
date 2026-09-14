// @vitest-environment jsdom
//
// F007 (portal-simplify, AS-013): the Messages page's "Your requests"
// section reuses `RequestList` unmodified over `getPortalRequests` filtered
// to this project (see conversation/page.tsx). This asserts the reused
// component actually renders each status label and a decline reason where
// present -- the behaviour AS-013 depends on -- directly against
// `RequestList`, the same component the Messages page wires in.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/client-requests", () => ({
  withdrawClientRequest: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    })),
    removeChannel: vi.fn(),
  }),
}));

import { RequestList } from "@/components/portal/request-list";
import type { PortalRequest } from "@/lib/queries/portal";

afterEach(() => {
  cleanup();
});

const baseRequest: PortalRequest = {
  id: "req-1",
  projectId: "project-1",
  projectName: "Website redesign",
  title: "Add a pricing page",
  body: null,
  desiredBy: null,
  status: "submitted",
  declineReason: null,
  convertedTaskId: null,
  convertedTaskTitle: null,
  convertedTaskStatus: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("RequestList — F007 AS-013: statuses and decline reason visible on Messages", () => {
  it("test_AS_013_submitted_status_renders", () => {
    render(<RequestList requests={[baseRequest]} projectId="project-1" />);
    expect(screen.getByText("Waiting for review")).toBeInTheDocument();
  });

  it("test_AS_013_accepted_status_and_task_link_render", () => {
    render(
      <RequestList
        requests={[
          {
            ...baseRequest,
            id: "req-2",
            status: "accepted",
            convertedTaskId: "task-1",
            convertedTaskTitle: "Pricing page",
            convertedTaskStatus: "in_progress",
          },
        ]}
        projectId="project-1"
      />,
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText(/On the board as "Pricing page"/)).toBeInTheDocument();
  });

  it("test_AS_013_declined_status_with_reason_renders", () => {
    render(
      <RequestList
        requests={[
          {
            ...baseRequest,
            id: "req-3",
            status: "declined",
            declineReason: "Out of scope for this phase.",
          },
        ]}
        projectId="project-1"
      />,
    );
    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("Out of scope for this phase.")).toBeInTheDocument();
  });
});
