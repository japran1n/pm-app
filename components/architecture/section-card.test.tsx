// @vitest-environment jsdom
//
// F094: after saving in NodeMetaDialog, the section card icon must repaint
// to filled state without a full page reload. `router.refresh()` alone only
// re-renders server components -- it never re-runs the client-side
// `getNodeDetailsForToggle` fetch in architecture-view-toggle.tsx, so the
// `invalidateDetails` callback (threaded down here as `onDetailsInvalidate`)
// must be called from NodeMetaDialog's `onSaved` alongside `router.refresh()`
// so the board-wide details cache drops and refetches.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
  useParams: () => ({ projectId: "project-1" }),
}));

const setNodeMetaMock = vi.fn();
vi.mock("@/lib/actions/architecture", () => ({
  renameSection: vi.fn(),
  setNodeMeta: (...args: unknown[]) => setNodeMetaMock(...args),
}));

import { SectionCard } from "./section-card";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
import type { BoardSection } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const section: BoardSection = {
  id: "section-1",
  title: "Hero",
  position: 0,
  kind: "static",
  component: null,
};

function emptyDetailsData(): ArchitectureNodeDetails {
  return new Map();
}

describe("SectionCard copy-brief save (F094)", () => {
  it("test_F094_invalidateDetails_is_called_when_NodeMetaDialog_onSaved_fires", async () => {
    setNodeMetaMock.mockResolvedValue({ success: true });
    const onDetailsInvalidate = vi.fn();

    render(
      <SectionCard
        section={section}
        detailsData={emptyDetailsData()}
        onDetailsInvalidate={onDetailsInvalidate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Add copy brief for ${section.title}` }),
    );

    const saveButton = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onDetailsInvalidate).toHaveBeenCalledTimes(1);
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("test_F094_save_does_not_throw_when_onDetailsInvalidate_is_a_noop", async () => {
    setNodeMetaMock.mockResolvedValue({ success: true });

    render(
      <SectionCard
        section={section}
        detailsData={emptyDetailsData()}
        onDetailsInvalidate={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Add copy brief for ${section.title}` }),
    );

    const saveButton = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
