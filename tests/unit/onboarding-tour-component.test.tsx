// @vitest-environment jsdom
//
// F253 (AS-491, AS-492, AS-493): DOM-level proof that the tour actually
// shows/hides/persists, not just that its Server Action is wired
// correctly (that half is covered by tests/unit/onboarding-tour.test.ts).

import { createElement } from "react";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { __resetEscapeLayersForTests } from "@/lib/hooks/use-shortcut";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
}));

import { ShortcutProvider } from "@/components/command/shortcut-provider";

const dismissTourMock = vi.fn(async () => ({ ok: true }) as const);

vi.mock("@/lib/actions/onboarding-tour", () => ({
  dismissTour: () => dismissTourMock(),
  replayTour: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  __resetEscapeLayersForTests();
  document.body.innerHTML = "";
  // The component's own dismiss handler (components/onboarding/tour.tsx)
  // writes a REAL `window.localStorage` entry
  // (`pm-app-tour-dismissed`) as a same-browser safety net, independent
  // of the mocked `dismissTour` server action -- this is real jsdom
  // `localStorage`, not mocked, and jsdom does not reset it between
  // tests in the same file on its own. Without clearing it here, the
  // earlier "dismissing calls the persistence action..." test's real
  // dismiss leaves the flag set, so every later test in this file mounts
  // against an already-"locally dismissed" tour and never sees "Welcome
  // to pm-app" at all -- not a rendering bug, a missing test-isolation
  // reset. (Whether this actually manifests depends on the jsdom/Node
  // localStorage wiring in a given run, which is why it was intermittent
  // rather than a hard, always-reproducing failure on every machine.)
  try {
    window.localStorage?.clear();
  } catch {
    // jsdom's localStorage isn't available in every environment this
    // suite runs in (observed locally) — the component's own
    // `readLocallyDismissed` already treats that the same way (falls
    // back to `false`), so a missing/inaccessible localStorage here is a
    // no-op, not a test failure.
  }
});

async function importTour() {
  const mod = await import("@/components/onboarding/tour");
  return mod.OnboardingTour;
}

describe("OnboardingTour (AS-491, AS-492, AS-493)", () => {
  it("test_AS_491_offers_the_tour_to_a_first_time_user_with_sidebar_board_and_task_creation_steps", async () => {
    document.body.innerHTML = `
      <nav data-tour="sidebar-nav"></nav>
      <div data-tour="board-view"></div>
      <span data-tour="new-task-trigger"></span>
    `;
    const OnboardingTour = await importTour();

    render(createElement(OnboardingTour, { initialDismissed: false }));

    // Welcome step first.
    expect(screen.getByText("Welcome to pm-app")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByText("Your workspace nav")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByText("The board")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByText("Create a task")).toBeInTheDocument(),
    );
  });

  it("test_AS_491_skips_a_step_whose_target_does_not_exist_for_this_viewer", async () => {
    // No `new-task-trigger` in the DOM (e.g. a viewer who cannot create
    // tasks never has this control rendered at all).
    document.body.innerHTML = `
      <nav data-tour="sidebar-nav"></nav>
      <div data-tour="board-view"></div>
    `;
    const OnboardingTour = await importTour();

    render(createElement(OnboardingTour, { initialDismissed: false }));

    fireEvent.click(screen.getByRole("button", { name: "Next" })); // welcome -> sidebar
    await waitFor(() =>
      expect(screen.getByText("Your workspace nav")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // sidebar -> board
    await waitFor(() =>
      expect(screen.getByText("The board")).toBeInTheDocument(),
    );
    // "Done" (last step), not "Next" -- "Create a task" was skipped since
    // its target never existed.
    expect(
      screen.getByRole("button", { name: "Done" }),
    ).toBeInTheDocument();
  });

  it("test_AS_492_dismissing_calls_the_persistence_action_and_removes_the_tour_from_the_DOM", async () => {
    document.body.innerHTML = `<nav data-tour="sidebar-nav"></nav>`;
    const OnboardingTour = await importTour();

    render(createElement(OnboardingTour, { initialDismissed: false }));
    expect(screen.getByText("Welcome to pm-app")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(dismissTourMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Welcome to pm-app")).not.toBeInTheDocument();
  });

  it("test_AS_492_does_not_reappear_after_a_reload_when_already_dismissed", async () => {
    // A "reload" is simulated by mounting a fresh instance with the
    // server-fetched `initialDismissed: true` a real reload would produce
    // once dismissTour has persisted server-side (see
    // tests/unit/onboarding-tour.test.ts's getTourStatus coverage of that
    // persisted-read half).
    document.body.innerHTML = `<nav data-tour="sidebar-nav"></nav>`;
    const OnboardingTour = await importTour();

    render(createElement(OnboardingTour, { initialDismissed: true }));

    expect(screen.queryByText("Welcome to pm-app")).not.toBeInTheDocument();
    expect(dismissTourMock).not.toHaveBeenCalled();
  });

  it("test_AS_492_Escape_dismisses_the_tour_cooperating_with_the_shared_escape_layer_stack", async () => {
    document.body.innerHTML = `<nav data-tour="sidebar-nav"></nav>`;
    const OnboardingTour = await importTour();

    render(
      createElement(
        "div",
        null,
        createElement(ShortcutProvider),
        createElement(OnboardingTour, { initialDismissed: false }),
      ),
    );
    expect(screen.getByText("Welcome to pm-app")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(dismissTourMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Welcome to pm-app")).not.toBeInTheDocument();
  });
});
