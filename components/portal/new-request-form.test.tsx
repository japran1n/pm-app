// @vitest-environment jsdom
//
// F079 (missions/20260903-portal audit, defect 2): once
// `p/[projectId]/requests/page.tsx` is project-scoped, a `<select>`
// offering every OTHER portal-enabled project on the workspace has no
// reason to exist — it would let a client file a request against a
// project the page they are looking at has nothing to do with. This
// covers the `fixedProjectId` prop that replaces it with a fixed hidden
// field.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { NewRequestForm } from "@/components/portal/new-request-form";

vi.mock("@/lib/actions/client-requests", () => ({
  createClientRequest: vi.fn(async () => ({ ok: true, data: { requestId: "r1" } })),
}));

afterEach(() => {
  cleanup();
});

describe("NewRequestForm — F079 defect 2: project-scoped form has no cross-project picker", () => {
  it("test_fixedProjectId_renders_no_project_select", () => {
    render(
      <NewRequestForm
        projects={[]}
        fixedProjectId={{ id: "project-1", name: "Website redesign" }}
      />,
    );

    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.getByText("New request")).toBeInTheDocument();
  });

  it("test_fixedProjectId_posts_the_fixed_project_id_via_a_hidden_field", () => {
    const { container } = render(
      <NewRequestForm
        projects={[]}
        fixedProjectId={{ id: "project-1", name: "Website redesign" }}
      />,
    );

    const hidden = container.querySelector('input[type="hidden"][name="projectId"]');
    expect(hidden).toBeInTheDocument();
    expect(hidden).toHaveValue("project-1");
  });

  it("test_without_fixedProjectId_the_project_select_still_renders_for_multiple_projects", () => {
    render(
      <NewRequestForm
        projects={[
          { id: "project-1", name: "Website redesign" },
          { id: "project-2", name: "Brand refresh" },
        ]}
      />,
    );

    expect(screen.getByLabelText("Project")).toBeInTheDocument();
  });
});
