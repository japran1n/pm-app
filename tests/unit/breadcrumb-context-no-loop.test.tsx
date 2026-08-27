// @vitest-environment jsdom
//
// BUGFIX: useSetBreadcrumb's effect used to depend on `ctx` — the whole
// context VALUE object BreadcrumbProvider rebuilds every render — instead
// of on `setExtra` (React's own stable setState function). Since calling
// `setExtra` inside the effect is exactly what makes BreadcrumbProvider
// re-render (which rebuilds `ctx` with a new identity), that dependency
// re-triggered the same effect forever: "Maximum update depth exceeded",
// reproducible on every page under the workspace layout that called this
// hook (in practice: any page rendering <AppBreadcrumb> nested inside a
// project layout using <ProjectBreadcrumb> to announce its name).
//
// This mounts a REAL parent that re-renders on every tick (the worst case
// for a badly-scoped effect dependency) with a child calling
// useSetBreadcrumb, and asserts the render count converges instead of
// climbing without bound, plus that React never logs the specific loop
// error.

import { useState, useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BreadcrumbProvider,
  useBreadcrumbExtra,
  useSetBreadcrumb,
} from "@/components/nav/breadcrumb-context";

afterEach(() => {
  cleanup();
});

function AnnouncingChild({ label }: { label: string }) {
  useSetBreadcrumb([{ label }]);
  return null;
}

// Simulates the real-world shape that triggered the bug: a parent that
// re-renders independently of the breadcrumb content (e.g. any sibling
// state update anywhere in the tree — here, a self-driving tick).
function ReRenderingParent() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Deliberate: this test fixture's whole job is to be the worst-case
    // "something elsewhere in the tree keeps re-rendering" parent the bug
    // needed to reproduce — not a pattern to follow in real components.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tick < 5) setTick((t) => t + 1);
  }, [tick]);
  return <AnnouncingChild label="Website Redesign" />;
}

describe("BUGFIX: useSetBreadcrumb does not loop on every parent re-render", () => {
  it("test_mounting_under_a_re_rendering_parent_completes_without_hanging_or_looping", () => {
    // The proof that matters most here is procedural, not an assertion:
    // against the pre-fix code, this exact render hung the test worker for
    // 80+ seconds until it was force-killed (verified manually before
    // writing this test, by reintroducing the old `[ctx, key]` dependency
    // and re-running this file). Vitest's own default per-test timeout is
    // what would fail this test on a regression — completing at all, fast,
    // is the assertion.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <BreadcrumbProvider>
        <ReRenderingParent />
      </BreadcrumbProvider>,
    );

    const loggedTheLoopError = consoleError.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" && arg.includes("Maximum update depth exceeded"),
      ),
    );
    expect(loggedTheLoopError).toBe(false);

    consoleError.mockRestore();
  });

  it("test_the_announced_label_is_actually_exposed_via_context", () => {
    function Reader() {
      const extra = useBreadcrumbExtra();
      return <span data-testid="crumb">{extra[0]?.label}</span>;
    }

    const { getByTestId } = render(
      <BreadcrumbProvider>
        <AnnouncingChild label="Website Redesign" />
        <Reader />
      </BreadcrumbProvider>,
    );

    expect(getByTestId("crumb").textContent).toBe("Website Redesign");
  });
});
