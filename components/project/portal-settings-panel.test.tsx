// @vitest-environment jsdom
//
// F090 item 4: the "Client portal" project settings tab's launch
// confidence <Select> already maps the raw `launch_confidence` enum
// through `CONFIDENCE_LABELS` (see portal-settings-panel.tsx's own
// `CONFIDENCE_LABELS` const) -- this file locks that in with a real
// test, since no test previously existed for this component at all (it
// shipped untested in F080). Asserts the select's own trigger shows the
// human label, never the raw `on_track` enum value.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/portal-settings", () => ({
  setPortalEnabled: vi.fn(),
  updateProjectLaunch: vi.fn(),
}));

import { PortalSettingsPanel } from "./portal-settings-panel";

afterEach(cleanup);

const READINESS = {
  hasClientMember: true,
  hasPhase: true,
  hasClientVisibleTask: true,
};

function renderPanel(
  overrides: Partial<Parameters<typeof PortalSettingsPanel>[0]> = {},
) {
  return render(
    createElement(PortalSettingsPanel, {
      workspaceSlug: "acme",
      projectId: "project-1",
      portalEnabled: true,
      readiness: READINESS,
      canManagePortal: true,
      canEditLaunch: true,
      launch: {
        targetLaunchDate: "2026-10-01",
        launchConfidence: "on_track",
        launchNote: null,
        warrantyUntil: null,
        warrantyTerms: null,
      },
      ...overrides,
    }),
  );
}

describe("test_AS_090_4_launch_confidence_select_shows_human_labels", () => {
  it("shows 'On track', never the raw 'on_track' enum, for the selected value", () => {
    renderPanel();

    const trigger = screen.getByLabelText(/launch confidence/i);
    expect(trigger).toHaveTextContent("On track");
    expect(trigger).not.toHaveTextContent("on_track");
  });

  it("every option in the dropdown is a human label, not a raw enum value", () => {
    renderPanel({ launch: { targetLaunchDate: null, launchConfidence: null, launchNote: null, warrantyUntil: null, warrantyTerms: null } });

    const trigger = screen.getByLabelText(/launch confidence/i);
    expect(trigger).toHaveTextContent("Not set");
    expect(trigger).not.toHaveTextContent("on_track");
    expect(trigger).not.toHaveTextContent("at_risk");
    expect(trigger).not.toHaveTextContent("slipped");
  });
});
