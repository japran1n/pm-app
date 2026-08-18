# F277: real DOM tests instead of source-text greps

**Milestone:** M10 (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** F122
**Parent feature:** F122 (inherits its clarification)

## Assertion IDs covered
- AS-214: avatars appear on task cards, in the members list, on comments, and in assignee pickers
- AS-204 (hardening): deterministic per-user colour

## Why this exists
M10 scrutiny FAIL: the only AS-214 test is a `readFileSync` + regex over source text — it would pass if `UserAvatar` returned `null`. The repo has no DOM test environment at all, and eleven sibling test files use the same pattern. The entire contrast story hangs on one untested line: if `style={{ color: color.foreground }}` were dropped, every pair collapses toward 1.0:1 while all 23 tests stay green. See `missions/20260818-213033/milestones/M10-scrutiny.md` § AS-214 and § AS-204.

## Draft scope
- Add jsdom (or happy-dom) plus `@testing-library/react` to `vitest.config.ts`.
- Rewrite the AS-214 test as real render assertions: task card, members row, comment, assignee picker option — assert an avatar node with the expected initials, background colour, and accessible name.
- Add a render-level contrast test that reads the computed foreground off a rendered fallback.
- Fix `initialsFor` to use `Array.from(label)` so astral characters (emoji in a display name) do not render a replacement glyph.
- Add the golden `id -> index` assertion that `tests/unit/user-color.test.ts` names but does not currently make; either replace the `* 33` hash (its low bits never mix for power-of-two palette lengths, making it anagram-invariant) or document that the module must not be reused for short keys.

## Files (approximate)
vitest.config.ts, package.json, tests/unit/user-avatar.test.tsx (new), tests/unit/user-color.test.ts, lib/user-color.ts

## Clarified implementation
- Inherits F122's clarification (archetype: ui/logic). The hash change, if made, must keep the palette contrast guarantees intact.

## Definition of done
- Dropping the foreground colour style fails a test.
- `UserAvatar` returning null fails a test.
- Emoji display names render correct initials.
- `npm run test`, `npx tsc --noEmit`, `npx eslint .` clean.
