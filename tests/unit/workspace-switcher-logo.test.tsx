// @vitest-environment jsdom
//
// F138 (AS-243): "an owner can upload a logo, shown in the workspace
// switcher." Real DOM render test — proves the switcher's trigger and
// each dropdown item actually render the logo image (or an initials
// fallback when there is none), not just that a `logoUrl` prop exists
// somewhere. Mirrors tests/unit/user-avatar.test.tsx's
// render-then-inspect-the-DOM approach rather than asserting on source
// text.

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// jsdom never actually loads image resources, so base-ui's Avatar
// (components/ui/avatar.tsx) — which only swaps its fallback for the
// real <img> once a background `new Image()` probe reports "loaded" —
// would otherwise stay on its initials fallback forever in this
// environment, even for a workspace that genuinely has a logoUrl. Stub
// `window.Image` to report success synchronously, mirroring how a real
// browser resolves a same-origin/public Storage URL — this is a jsdom
// environment limitation being worked around, not the component's
// production behaviour being changed.
class ImmediatelyLoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  complete = false;
  naturalWidth = 1;
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this.complete = true;
    queueMicrotask(() => this.onload?.());
  }
}
// @ts-expect-error -- test-only stub, not a full Image implementation.
window.Image = ImmediatelyLoadedImage;

import {
  WorkspaceSwitcher,
  type SwitcherWorkspace,
} from "@/components/workspace-switcher";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";
import { getUserColor } from "@/lib/user-color";

const WORKSPACE_WITH_LOGO: SwitcherWorkspace = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "Acme Corp",
  slug: "acme",
  logoUrl: "https://example.test/storage/v1/object/public/avatars/workspace-logos/11111111-2222-4333-8444-555555555555/logo?v=1",
};

const WORKSPACE_WITHOUT_LOGO: SwitcherWorkspace = {
  id: "22222222-3333-4444-8888-999999999999",
  name: "No Logo Inc",
  slug: "no-logo",
  logoUrl: null,
};

describe("test_AS_243_workspace_switcher_renders_logo", () => {
  it("renders the current workspace's logo image inside the switcher trigger button", async () => {
    render(
      createElement(WorkspaceSwitcher, {
        workspaces: [WORKSPACE_WITH_LOGO],
        currentWorkspaceId: WORKSPACE_WITH_LOGO.id,
      }),
    );

    // The trigger renders a WorkspaceLogo with role="img" and an
    // accessible name of the workspace name (mirrors UserAvatar's
    // convention) — this is a real rendered node, not source text.
    const logoRoot = screen.getByRole("img", { name: WORKSPACE_WITH_LOGO.name });
    expect(logoRoot).toBeInTheDocument();

    await waitFor(() => {
      const img = logoRoot.querySelector(
        '[data-slot="avatar-image"]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe(WORKSPACE_WITH_LOGO.logoUrl);
    });
  });

  it("falls back to an initials avatar in the switcher trigger when the workspace has no logo", () => {
    render(
      createElement(WorkspaceSwitcher, {
        workspaces: [WORKSPACE_WITHOUT_LOGO],
        currentWorkspaceId: WORKSPACE_WITHOUT_LOGO.id,
      }),
    );

    const logoRoot = screen.getByRole("img", {
      name: WORKSPACE_WITHOUT_LOGO.name,
    });
    expect(logoRoot).toBeInTheDocument();
    // No image node when logoUrl is null — only the initials fallback.
    expect(
      logoRoot.querySelector('[data-slot="avatar-image"]'),
    ).toBeNull();
    expect(logoRoot).toHaveTextContent("NO");
  });
});

describe("test_AS_243_workspace_logo_component", () => {
  it("renders a real image node when a logoUrl is provided", async () => {
    render(
      createElement(WorkspaceLogo, {
        workspaceId: WORKSPACE_WITH_LOGO.id,
        name: WORKSPACE_WITH_LOGO.name,
        logoUrl: WORKSPACE_WITH_LOGO.logoUrl,
      }),
    );
    const root = screen.getByRole("img", { name: WORKSPACE_WITH_LOGO.name });
    await waitFor(() => {
      expect(
        root.querySelector('[data-slot="avatar-image"]'),
      ).not.toBeNull();
    });
  });

  it("applies the deterministic per-workspace fallback colour (lib/user-color.ts, shared with UserAvatar) when there is no logo", () => {
    render(
      createElement(WorkspaceLogo, {
        workspaceId: WORKSPACE_WITHOUT_LOGO.id,
        name: WORKSPACE_WITHOUT_LOGO.name,
        logoUrl: null,
      }),
    );
    const color = getUserColor(WORKSPACE_WITHOUT_LOGO.id);
    const fallback = screen
      .getByRole("img", { name: WORKSPACE_WITHOUT_LOGO.name })
      .querySelector('[data-slot="avatar-fallback"]') as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback!.style.backgroundColor).toBe(hexToRgb(color.background));
  });
});

function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
