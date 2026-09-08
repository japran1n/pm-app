# Mission 20260909-linear-ds — Linear Design System Migration

Migrate pm-app from Good Guys 3.0 (shadcn base-nova, Geist, light-only,
brand #3670e1) to a Linear-reproduced design system — reconstructed 1:1
from Linear's live CSS custom properties (read from linear.app, 8 Sep 2026).

## Hard constraint — visual only

**Nothing about current system functionality changes. Only the visual design
system.** No routes, data models, server actions, API signatures, component
props, user flows, or behavioral assertions change.

Test every PR must pass:
> Would a user who knows the app by heart need to learn anything new?
> If yes — out of scope.

## Key decisions (pre-resolved, no user input needed)

- **Portal:** Option B — portal stays on Good Guys 3.0 light tokens under
  `[data-surface="portal"]` scope; workspace internals go Linear dark.
- **Mono font:** Keep IBM Plex Mono (not Berkeley Mono).
- **Status:** Restylize existing text pills (outline + color dot) — no icon replacement.

## Scope summary

Change: colors, typography, radii, borders, elevation, density, and markup
only where structurally necessary (e.g. panel wrapper div).

Do NOT change: routes, data, queries, server actions, component API/props,
user flows, `resolveClientBucket`, behavioral assertions.
