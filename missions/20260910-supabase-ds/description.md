# Mission — Supabase Design System

Migrate the whole of pm-app onto Supabase's design system: the generative
OKLCH token engine from `packages/ui`, its Inter/Source Code Pro typography,
its component anatomy, and its light + dark themes.

This supersedes `20260909-linear-ds` (Good Guys 4.0 / Linear). That mission
is COMPLETE and its files stay byte-identical as history; see the
supersession record in this mission's validation contract.

## Why

The Linear reproduction landed correctly against its own contract but did not
land aesthetically for the product owner. A working lab
(`~/Desktop/supabase-ds-lab`, Members screen on the real Supabase Platform Kit
plus Supabase's own theme CSS) was built and accepted as the target.

## Scope

Everything. Workspace internals and the client portal both move onto the same
system. Good Guys 3.0's separate light palette under `[data-surface="portal"]`
is retired in favour of Supabase's own light theme — one engine, two themes.

## Deliberate scope expansion

This mission adds one thing a user must learn: **a light/dark theme switch**,
on both the workspace and the portal. That is new user-visible functionality
and therefore falls outside CLAUDE.md's "would a user need to learn anything
new" design-system scope rule. It is included at the product owner's explicit
request and carries its own assertions (SD-020…SD-024) so it is validated as a
feature, not smuggled in as styling.

## Source of truth

Supabase's published CSS and component source, not reproduction from memory:

- `packages/ui/build/css/source/semantic.css` — the token engine
- `packages/ui/build/css/source/compat.css` — legacy name aliases
- `packages/ui/build/css/themes/dark.css`, `themes/light.css` — theme knobs
- `packages/ui/src/components/**` — component anatomy (cva strings)
- `apps/design-system/styles/globals.css` — type scale and font mapping

## Non-goals

- No behaviour changes. Same screens, same flows, same copy.
- No data-model or permission changes.
- `resolveClientBucket` in `components/portal/status-label.ts` is not touched.
- Supabase Platform Kit itself is NOT installed. It is an embedded database
  admin panel, not a design system; the lab proved the look comes from the
  theme CSS and component anatomy, which we port directly.
