// Unit test for F158's shared confirm-before-completing-a-blocked-task
// guard (components/task/blocked-done-guard.tsx's useBlockedDoneGuard
// hook + the AlertDialog it returns as `dialog`).
//
// Same "no DOM test environment yet" convention as every other
// task-detail-section render test in this repo (see
// tests/unit/checklist-ui-render.test.ts's own doc comment) —
// vitest.config.ts pins `environment: "node"`, real jsdom/Testing-Library
// interaction testing arrives in F277.
//
// What an SSR render CAN genuinely prove, and what it can't:
//   - CAN prove: a component that calls useBlockedDoneGuard() and renders
//     its returned `dialog` does not crash, and that the CLOSED dialog's
//     blocker-list markup is absent from the static output (Base UI's
//     AlertDialog, like F157's Popover/Command, only portals its content
//     when open — confirmed empirically below, mirroring
//     tests/unit/dependencies-ui-render.test.ts's own documented finding
//     for Popover).
//   - CANNOT prove: that confirmIfMovingToDone actually opens the dialog,
//     lists the right blockers, or that clicking Cancel/"Mark as done
//     anyway" resolves the pending promise correctly — the dialog only
//     opens in response to a real async confirmIfMovingToDone call
//     resolving with blockers, which needs a live network round trip
//     (getOpenBlockers) and real browser interaction to drive. That
//     genuinely-live proof belongs to tests/e2e/blocked-done-guard.spec.ts
//     (Playwright, a real browser, a real running app); this file only
//     proves the hook/dialog mounts safely and stays inert while closed.
//
// The actual "which blockers count as open" data-shaping logic is
// covered independently by tests/integration/open-blockers.test.ts's
// getOpenBlockers assertions (AS-280, AS-281) — this file only proves
// the hook's own render behaviour.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";

function Harness() {
  const { dialog } = useBlockedDoneGuard();
  return dialog;
}

describe("useBlockedDoneGuard (F158: AS-280, AS-281)", () => {
  it("renders without crashing while closed (no confirmIfMovingToDone call has been made)", () => {
    const html = renderToStaticMarkup(createElement(Harness));
    // Closed by default (`pending` starts null) — Base UI's AlertDialog
    // only portals its Popup content when open, so none of the dialog's
    // own text should appear in the initial static markup.
    expect(html).not.toContain("Mark as done anyway");
    expect(html).not.toContain("still blocked by");
  });
});
