# Tech Decisions — 20260909-linear-ds

All verified against current codebase state. No external service changes.

## Typography

**Inter Variable** via `next/font/google` — already available in Google Fonts.
Replaces Geist (currently loaded in `app/layout.tsx`).
- Axes: `["opsz"]` for optical sizing
- Feature settings: `"cv01", "ss03"` (Linear's character variants)
- Weights used: 300, 400, 510, 590, 680

**IBM Plex Mono** — keep as-is. Already loaded. Berkeley Mono declined (cost).

## Token architecture

- Keep shadcn semantic token names (--background, --card, --primary, etc.)
- Change only values in `:root` block of `app/globals.css`
- Add two new tokens: `--line-row` and `--bg-hover`
- Add `--font-weight-medium: 510` and `--font-weight-semibold: 590` to `@theme inline`
- Portal scope: `[data-surface="portal"]` block with Good Guys 3.0 values

## Type scale

New `@layer components` type classes in `globals.css`:
- `.text-tiny` (10px), `.text-micro` (12px), `.text-mini` (13px)
- `.text-small` (14px), `.text-regular` (15px), `.text-large` (17px)
- `.title-1` (17px/590), `.title-2` (20px/590), `.title-3` (24px/590)

## No new dependencies

Zero new npm packages. Zero new MCP servers. All changes are CSS and Tailwind classes.

## Branch strategy

`design/linear` branch. One PR per phase (9 phases). Scrutiny validator after Phase 3 and Phase 6.
