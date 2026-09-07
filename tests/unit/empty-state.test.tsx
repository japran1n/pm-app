import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

// The shared, generic empty-state building block (components/empty-state.tsx)
// used across projects/docs/watching/team pages instead of each surface
// hand-rolling its own icon-circle + title + description + action markup.
// These tests assert the building block itself renders every part
// correctly, independent of any one caller's implementation.
describe("EmptyState", () => {
  it("renders the icon, title, and description", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        icon: FolderKanban,
        title: "No projects yet",
        description: "Create your first project to start organizing work.",
      }),
    );

    expect(html).toContain("No projects yet");
    expect(html).toContain("Create your first project to start organizing work.");
    // The icon renders as an svg inside a muted circular wrapper.
    expect(html).toMatch(/<svg/);
  });

  it("omits the action entirely when none is provided", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        icon: FolderKanban,
        title: "Nothing here",
        description: "Nothing to show.",
      }),
    );

    expect(html).not.toContain("data-testid=\"empty-state-action\"");
  });

  it("renders a provided action node", () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyState,
        {
          icon: FolderKanban,
          title: "No documents yet",
          description: "Create your first document.",
        },
        null,
      ),
    );

    const withAction = renderToStaticMarkup(
      createElement(EmptyState, {
        icon: FolderKanban,
        title: "No documents yet",
        description: "Create your first document.",
        action: createElement("button", null, "New document"),
      }),
    );

    expect(html).not.toContain("New document");
    expect(withAction).toContain("New document");
  });
});
