# Tech Decisions — 20260910-supabase-ds

Versions verified 2026-09-10 against the npm registry and the vendors' own
sources. Do not carry these forward without re-checking.

---

## Already in the project — unchanged

| Package | Installed | Latest | Action |
|---|---|---|---|
| `next` | 16.3.1 | 16.3.4 | Leave. Not this mission's business. |
| `tailwindcss` | ^4 | 4.x | Leave. Supabase is on v4 too. |
| `@base-ui/react` | ^1.7.0 | 1.8.0 | Leave on 1.7.0. See "primitives" below. |

Source: `https://registry.npmjs.org/@base-ui/react` — 1.8.0 published
2026-09-04.

## Added

| Package | Version | Why |
|---|---|---|
| `next-themes` | 0.4.6 | Theme switch (SD-020…SD-024). Latest release, published 2025-03-11; confirmed working with Next.js 16 App Router + Tailwind v4. |

Sources:
- `https://registry.npmjs.org/next-themes`
- `https://github.com/pacocoursey/next-themes`
- `https://ui.shadcn.com/docs/dark-mode/next`

Configured with `attribute={["class", "data-theme"]}` so it stamps **both**
selectors Supabase's theme files target (`.dark` and `[data-theme='dark']`).
`disableTransitionOnChange` on, to avoid every token animating on switch.

## Fonts

| Face | Role | Source |
|---|---|---|
| Inter | UI / body, weight 450 | `next/font/google`, no `opsz` axis |
| Source Code Pro | mono / all machine data | `next/font/google` |

Exposed as `--font-inter` and `--font-source-code-pro`, the variable names
Supabase's own `apps/design-system/styles/globals.css` reads.

**Dropped:** IBM Plex Mono. **Not adopted:** Manrope. Supabase maps it to
`--font-heading` but its product UI does not use it; adding a third family
for no visible gain is not worth the payload.

## Removed

Nothing is uninstalled by this mission. The Good Guys 3.0 and Linear token
values live only in `app/globals.css` and are replaced in place.

## Primitives — the decision that shapes P4

pm-app is on **Base UI**; Supabase is on **Radix**. We do **not** migrate
primitives. Supabase's design lives entirely in its `cva` class strings, so
those are ported onto pm-app's existing Base UI shells.

Measured: only 21 of 34 files in `components/ui/` import `@base-ui/react` at
all. The remaining 13 are pure CSS and take Supabase's classes directly.

State-attribute mapping, already the convention in this codebase:

| Supabase (Radix) | pm-app (Base UI) |
|---|---|
| `data-[state=open]` | `aria-expanded` |
| `data-[state=checked]` | `data-[state=checked]` (same) |
| `data-[side=*]` | `data-[side=*]` (same) |

21 occurrences across Supabase's Button and Select.

## Platform Kit — evaluated and rejected

`npx shadcn@latest add @supabase/platform-kit-nextjs` was installed into a
throwaway lab and into pm-app on a scratch branch (reverted).

**Rejected.** It is an embedded Supabase admin panel — SQL editor, table
browser, log viewer — not a design system. It ships no Supabase tokens and no
Supabase Button or Badge; its `registryDependencies` pull **stock shadcn**
components. It would add 12 dependencies including `openai`,
`@monaco-editor/react` and `recharts` for zero design value, and its own
source carries 19 TypeScript errors against Zod v4.

The lab proved the look comes from the theme CSS plus component anatomy. We
port those directly.

## Vendored CSS

Four files are copied into `app/globals.css` verbatim, each under a comment
naming its upstream path and the date it was taken:

- `packages/ui/build/css/source/semantic.css`
- `packages/ui/build/css/source/compat.css`
- `packages/ui/build/css/themes/dark.css`
- `packages/ui/build/css/themes/light.css`

Vendored, not depended on: `packages/ui` is not published to npm. It exists
only inside the `supabase/supabase` monorepo, so there is no package to
install and no upstream to track automatically. Re-syncing is a manual,
deliberate act.
