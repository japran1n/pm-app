// @vitest-environment jsdom
//
// Feature request "Project ikonica/emoji": the icon picker grid in
// EditProjectDialog.
import { createElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const editProjectMock = vi.fn();
vi.mock("@/lib/actions/projects", () => ({
  editProject: (...args: unknown[]) => editProjectMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EditProjectDialog } from "@/components/edit-project-dialog";
import { PROJECT_ICON_ALLOWLIST } from "@/lib/validation/project-icons";

const project = {
  id: "proj-1",
  name: "Acme Project",
  description: null,
  startDate: null,
  endDate: null,
  icon: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EditProjectDialog icon picker", () => {
  it("shows every allow-listed emoji as a selectable option", async () => {
    render(createElement(EditProjectDialog, { workspaceId: "ws-1", project }));

    fireEvent.click(screen.getByRole("button", { name: `Edit ${project.name}` }));

    for (const emoji of PROJECT_ICON_ALLOWLIST) {
      expect(
        screen.getByRole("button", { name: `Use ${emoji} as the project icon` }),
      ).toBeInTheDocument();
    }
  });

  it("submits the selected icon via editProject", async () => {
    editProjectMock.mockResolvedValue({
      ok: true,
      data: { ...project, icon: PROJECT_ICON_ALLOWLIST[0], updatedAt: "now" },
    });

    render(createElement(EditProjectDialog, { workspaceId: "ws-1", project }));

    fireEvent.click(screen.getByRole("button", { name: `Edit ${project.name}` }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Use ${PROJECT_ICON_ALLOWLIST[0]} as the project icon`,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(editProjectMock).toHaveBeenCalledWith(
        project.id,
        "ws-1",
        expect.objectContaining({ icon: PROJECT_ICON_ALLOWLIST[0] }),
      );
    });
  });

  it("clears the icon back to null via the 'None' option", async () => {
    editProjectMock.mockResolvedValue({
      ok: true,
      data: { ...project, icon: null, updatedAt: "now" },
    });

    render(
      createElement(EditProjectDialog, {
        workspaceId: "ws-1",
        project: { ...project, icon: PROJECT_ICON_ALLOWLIST[0] },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: `Edit ${project.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "No icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(editProjectMock).toHaveBeenCalledWith(
        project.id,
        "ws-1",
        expect.objectContaining({ icon: null }),
      );
    });
  });
});
