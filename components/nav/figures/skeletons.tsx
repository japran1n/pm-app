// F017 (AS-017, AS-020): fallbacks for the F016 figures' `<Suspense>`
// boundaries. Each skeleton reserves exactly the OCCUPIED footprint of its
// figure's resolved "has a value" state, so nothing shifts once the async
// figure settles -- not the "empty" state, since a badge that resolves to
// nothing renders `null` and reserves no space (an empty badge is not a
// zero badge, per this feature's own key rule).

import { cn } from "@/lib/utils";

// approvals / requests / chat-unread badges (`*-badge-figure.tsx`) all
// render the exact same markup when they have a count: `<Badge
// variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">`.
// Matches that badge's box model (border, px-1.5, py-[3px] inherited from
// the base badge classes, text-[10px] line box) with a muted pulsing fill
// instead of digits, sized to a representative 1-2 digit count so layout
// doesn't jump when the real count streams in.
export function NavBadgeSkeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-5 shrink-0 animate-pulse rounded-md border border-current/20 bg-muted",
        className,
      )}
      aria-hidden="true"
    />
  );
}

// notification-bell-figure.tsx: the bell trigger is a `size="icon"` Button
// (h-[38px] w-[38px], max-md:size-11 in the mobile top bar) with the
// unread-count badge absolutely positioned on top of it -- the badge never
// changes the button's own footprint, so only the button's box needs to be
// reserved here.
export function NotificationBellSkeleton() {
  return (
    <span
      className="inline-flex h-[38px] w-[38px] shrink-0 animate-pulse rounded-md border border-border bg-muted max-md:size-11"
      aria-hidden="true"
    />
  );
}

// workspace-switcher-figure.tsx: the trigger is a `size="sm"` (h-[34px])
// outline Button spanning `w-full max-w-56` with a `rounded-lg` corner.
export function WorkspaceSwitcherSkeleton() {
  return (
    <span
      className="block h-[34px] w-full max-w-56 animate-pulse rounded-lg border border-border bg-muted"
      aria-hidden="true"
    />
  );
}

// tour-figure.tsx is intentionally NOT given a reserved-space skeleton:
// `<OnboardingTour>` renders `null` until its first active step, and once
// active it renders `position: fixed` overlay elements that never
// participate in document flow. There is no in-flow footprint to hold, so
// `fallback={null}` (unchanged from F016) is already correct here.
