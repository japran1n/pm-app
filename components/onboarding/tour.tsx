"use client";

// F253 (AS-491, AS-492, AS-493): a lightweight, 4-step first-run guided
// tour built from existing primitives (Button, Tailwind tokens) -- no
// tour library, per the clarified spec. Popovers are anchored to real DOM
// elements (via `data-tour="..."` attributes already on the sidebar nav,
// the board container, and the "New task" trigger) rather than a fixed
// script of coordinates, so the tour degrades gracefully if page layout
// changes.
//
// Mounted once, globally, from the workspace layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) alongside CommandPalette/
// ShortcutProvider -- `initialDismissed` is server-fetched there (the
// clarified "server-fetched... passed down as typed props" pattern) via
// lib/actions/onboarding-tour.ts's getTourStatus, so a returning user
// never sees a flash of the tour before a client-side check catches up.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";
import { dismissTour } from "@/lib/actions/onboarding-tour";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** null = a centered, unanchored step (the welcome step). */
  targetSelector: string | null;
};

// Exported so the replay entry point and tests can reference the exact
// same list the tour renders from -- one source of truth, matching this
// codebase's SHORTCUT_REGISTRY convention (lib/hooks/use-shortcut.ts).
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to pm-app",
    body: "Here's a quick look at where things live. You can skip this at any time.",
    targetSelector: null,
  },
  {
    id: "sidebar",
    title: "Your workspace nav",
    body: "Switch workspaces, jump between projects, and reach your profile from here.",
    targetSelector: '[data-tour="sidebar-nav"]',
  },
  {
    id: "board",
    title: "The board",
    body: "Drag cards between columns to update status. Group by assignee, priority, or tag from the toolbar.",
    targetSelector: '[data-tour="board-view"]',
  },
  {
    id: "create-task",
    title: "Create a task",
    body: "Add a task here, or press N anywhere in a project.",
    targetSelector: '[data-tour="new-task-trigger"]',
  },
] as const;

const CARD_WIDTH = 320;

// F272 (part 2): a race this session's e2e runs (and, by the same
// mechanism, real users) can hit — almost every Server Action in this
// app calls `revalidatePath(..., "layout")` on success (see e.g.
// lib/actions/tasks.ts's `moveTaskStatus`), which re-renders this
// component's SERVER parent (the workspace layout) and therefore
// REMOUNTS this Client Component with a freshly re-fetched
// `initialDismissed` prop. `finish()` below persists the dismissal via
// `dismissTour()` (an async Server Action) but does not — cannot,
// without blocking the UI on a network round trip — wait for that write
// to land before the user's very next action. If that next action
// triggers its own layout-revalidating Server Action before the pending
// `dismissTour()` write has committed, the remount reads the STILL-null
// `tour_completed_at` and revives the tour mid-session, even though the
// user already dismissed it. `localStorage` records the dismissal
// SYNCHRONOUSLY, client-side, independent of that network race, and is
// checked first — the server-fetched `initialDismissed` is still the
// correct source of truth for a genuinely fresh session (a new tab/
// device has no localStorage entry yet), this is purely a same-browser
// safety net against the specific revalidation race above.
const TOUR_DISMISSED_STORAGE_KEY = "pm-app-tour-dismissed";

function readLocallyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function OnboardingTour({
  initialDismissed,
}: {
  initialDismissed: boolean;
}) {
  const [active, setActive] = useState(!initialDismissed);
  const [stepIndex, setStepIndex] = useState(0);

  // F272 (part 2): the initial SERVER render (and React's matching FIRST
  // client render, before hydration/effects run) can never know which
  // `data-tour="..."` targets actually exist in the real DOM -- there is
  // no DOM on the server. The old `typeof document === "undefined"` guard
  // below tried to special-case that by returning an empty step list
  // server-side, but that makes the SERVER render `null` (line ~150's
  // `!step` bail) while the very next CLIENT render -- once `document`
  // exists -- computes a REAL step list and renders the full tour dialog
  // instead: a genuine, guaranteed (not intermittent) hydration mismatch
  // on every first-run page load, reproducibly forcing React to discard
  // and rebuild the whole tree under this component (confirmed via
  // several e2e specs' WebServer console output: "Hydration failed...
  // this tree will be regenerated on the client", occasionally cascading
  // into an uncaught `Cannot read properties of null (reading
  // 'parentNode')` that leaves the page's React tree dead). Standard
  // "client-only until mounted" fix: `mounted` is `false` on BOTH the
  // server and the client's first render (so they match -- no mismatch),
  // and only becomes `true` once React re-renders post-hydration, at
  // which point the real DOM-dependent step list is computed and the
  // tour appears -- one render later, not a flash the user would
  // meaningfully perceive, and no `typeof document` branch left in the
  // render path at all. `useSyncExternalStore` with a `getServerSnapshot`
  // that differs from `getSnapshot` is the React-documented way to do
  // this without a `useEffect` + `setState` pair (which would itself trip
  // this repo's react-hooks set-state-in-effect lint rule) -- same
  // pattern/rationale as components/theme-toggle.tsx's own `isClient`.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // F272 (part 2): a same-browser safety net against the revalidation
  // race documented on `readLocallyDismissed`'s own doc comment above —
  // checked only once `mounted` is true (post-hydration), so this can
  // never itself introduce a hydration mismatch the way seeding it into
  // `active`'s initial state directly would (localStorage genuinely
  // differs between the server's "no browser" render and the client's
  // real one, which is exactly the class of bug `mounted` above exists to
  // avoid).
  const locallyDismissed = mounted && readLocallyDismissed();
  const effectiveActive = active && !locallyDismissed;

  // AS-491's per-step skip rule: a step whose target doesn't exist in the
  // DOM right now (e.g. "create a task" for a viewer who can't create
  // tasks -- NewTaskDialog already hides/disables that control per role)
  // is dropped from the sequence entirely rather than shown pointing at
  // nothing. Recomputed only when the tour (re)activates, since targets
  // don't change mid-tour on a static page.
  const availableSteps = useMemo(() => {
    if (!effectiveActive || !mounted) return [] as TourStep[];
    return TOUR_STEPS.filter(
      (step) =>
        step.targetSelector === null ||
        document.querySelector(step.targetSelector) !== null,
    );
  }, [effectiveActive, mounted]);

  const step = availableSteps[stepIndex];

  // Recomputed on every render (a cheap `getBoundingClientRect()` call),
  // not stored in state set from inside an effect -- `resizeTick` below
  // only exists to force a re-render on resize/scroll, never to hold the
  // rect value itself, keeping this off the react-hooks
  // set-state-in-effect rule this repo lints with (see
  // components/theme-toggle.tsx's own comment on the same rule for the
  // established pattern of avoiding it rather than suppressing it).
  const [, setResizeTick] = useState(0);
  const rect: DOMRect | null =
    step?.targetSelector && typeof document !== "undefined"
      ? (document.querySelector(step.targetSelector)?.getBoundingClientRect() ??
        null)
      : null;

  useEffect(() => {
    if (!effectiveActive || !step) return;
    function forceRecompute() {
      setResizeTick((t) => t + 1);
    }
    window.addEventListener("resize", forceRecompute);
    window.addEventListener("scroll", forceRecompute, true);
    return () => {
      window.removeEventListener("resize", forceRecompute);
      window.removeEventListener("scroll", forceRecompute, true);
    };
  }, [effectiveActive, step]);

  // AS-492: persists per user (profiles.tour_completed_at), not
  // per-browser -- does not reappear after a reload or in a new tab.
  const finish = useCallback(() => {
    setActive(false);
    // F272 (part 2): set synchronously, BEFORE the async persistence
    // below even starts — see `readLocallyDismissed`'s doc comment for
    // the exact revalidation race this closes.
    try {
      window.localStorage.setItem(TOUR_DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Best-effort only (e.g. localStorage disabled/full) — the async
      // `dismissTour()` persistence below is still the real source of
      // truth for every OTHER browser/tab/device.
    }
    void dismissTour().then((result) => {
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  }, []);

  // Cooperates with F244's escape-layer stack (lib/hooks/use-shortcut.ts)
  // instead of a second document keydown listener: Escape closes the
  // tour only while it is the TOPMOST registered layer, same as every
  // other dismissible overlay in this codebase.
  useEscapeLayer(effectiveActive && Boolean(step), finish);

  // If every step got skipped (no matching target anywhere on this page
  // for this role), `step` is simply `undefined` and nothing renders --
  // no separate "was every step skipped" effect/state needed, `active`
  // itself stays true but harmlessly renders nothing until a page with a
  // matching target is reached.
  if (!effectiveActive || !step) return null;

  const isLast = stepIndex === availableSteps.length - 1;

  function goNext() {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function goBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const cardStyle: CSSProperties = rect
    ? {
        position: "fixed",
        top: Math.min(
          rect.bottom + 12,
          (typeof window !== "undefined" ? window.innerHeight : 800) - 220,
        ),
        left: Math.min(
          Math.max(rect.left, 16),
          (typeof window !== "undefined" ? window.innerWidth : 1280) -
            CARD_WIDTH -
            16,
        ),
        width: CARD_WIDTH,
        zIndex: 70,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: CARD_WIDTH,
        zIndex: 70,
      };

  return (
    <>
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[65] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={step.title}
        data-testid="onboarding-tour-step"
        className="rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
        style={cardStyle}
      >
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {stepIndex + 1} / {availableSteps.length}
            </span>
            {stepIndex > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={goBack}>
                Back
              </Button>
            )}
            <Button type="button" size="sm" onClick={goNext}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
