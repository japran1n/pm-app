// F267 (AS-519): a thin, always-present header rendered above every
// workspace page's own content, containing the header search input.
//
// AUTONOMOUS_DECISION (clarification's "simpler option, no new
// dependency, no second source of truth" default, recorded in the
// handoff's Decisions Made): this feature's draft scope also mentioned a
// header containing "the notification bell (F208) and the user menu" --
// both already live, working, and independently tested inside
// components/nav/app-sidebar.tsx (bell: desktop switcher row + mobile
// top bar per F208; user menu / sign-out: sidebar footer per F273/F256).
// Relocating them is not required by this feature's assigned assertions
// (AS-519..AS-522, all about the search input itself) and would touch
// F208/F253/F256/F273's already-tested layout in files outside this
// feature's own scope for no assertion-driven benefit. Left as
// Out-of-scope work in the handoff for a future, explicitly-scoped
// consolidation feature instead of silently expanding this one.
//
// Server Component: no interactivity of its own, just passes the
// workspace identifiers down to the Client Component (HeaderSearch) that
// actually needs them.

import { HeaderSearch } from "@/components/nav/header-search";

export function AppHeader({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b bg-background px-4">
      <HeaderSearch workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
    </header>
  );
}
