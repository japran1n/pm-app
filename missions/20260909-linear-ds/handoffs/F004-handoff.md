# Handoff: F004 — Type codemod: replace Tailwind text size classes with Linear scale

## Status
COMPLETE

## Assertions covered
Visual-only codemod feature; no behavioural assertions were assigned to F004 in the validation contract (pure class-rename, zero functionality change).

## Files changed
252 files under `app/` and `components/` (all `.tsx`/`.ts` files containing the target Tailwind text-size classes). Full list available via `git show --stat HEAD`.

## Commands run
`find app components ( -name "*.tsx" -o -name "*.ts" )` (0) — enumerated 486 candidate files
Python word-boundary-safe regex replacement script (0) — applied mapping to 252 files that matched
`command grep -rE "(^|[^-\w])text-sm([^-\w]|$)" app components --include="*.tsx" --include="*.ts"` (0, count 0) — verified no text-sm remains
`command grep -rE "(^|[^-\w])text-xs([^-\w]|$)" app components --include="*.tsx" --include="*.ts"` (0, count 0) — verified no text-xs remains
`command grep -rE "text-mini" app components` (0, count 596)
`command grep -rE "text-micro" app components` (0, count 350)
`command grep -rE "title-1|title-2|title-3" app components` (0, count 77)
`git status --short app/globals.css` (0, empty) — confirmed globals.css untouched
`npx tsc --noEmit` (2 pre-existing errors, unrelated to this change — confirmed identical on `git stash`/clean checkout, both in `tests/unit/docs-markdown-editor-export-import.test.tsx`)
`git commit` (0)

## Decisions made
- The spec's suggested `sed -i '' ... \b ...` commands do not work on macOS: BSD `sed` (the system `/usr/bin/sed` on this machine) does not support `\b` word-boundary regex tokens — it silently no-ops instead of erroring, so the naive sed approach produced zero changes despite exit code 0. Verified this with a minimal repro (`echo "test-sm hello" | sed -E 's/\btext-sm\b/text-mini/g'` leaves the string unchanged).
- Switched to a Python script performing the same word-boundary-safe replacement using a regex with negative lookaround `(?<![\w-])CLASS(?![\w-])` instead of `\b`, so `text-sm` is only replaced as a standalone token (preceded/followed by space, quote, backtick, start/end, or non-word/non-hyphen char) and not inside longer tokens like `text-small-caps` (none existed, but this guards against future ambiguity). Applied the exact mapping and order specified in the feature spec (4xl/3xl before 2xl/xl, etc.).
- Confirmed `app/globals.css` was never touched (it's excluded from the `app/`+`components/` .tsx/.ts glob entirely, so no special-casing was needed).
- The two `tsc --noEmit` errors were verified to pre-exist on the branch before this change (via `git stash`), so they're out of scope and not caused by this codemod.

## Out-of-scope work needed
None identified beyond the codemod itself. This feature only touches Tailwind class name tokens.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a Python regex script instead of the spec's literal `sed -i ''` command because BSD sed on macOS does not support `\b`, and the spec's own command would have silently produced zero replacements. The replacement semantics (word-boundary-safe class token matching, exact mapping and order) match the spec exactly — only the implementation mechanism differs to work around a platform limitation.

## Notes for the next worker
- On macOS, `\b` is unsupported by the system BSD `sed`; any future codemod tasks in this repo should use GNU sed (`gsed` if installed) or a Python/perl regex approach instead of BSD `sed -i '' -e 's/\bfoo\b/.../'`.
- Also note: in this sandboxed shell environment, `grep` is aliased to a shell function (wrapping `ugrep`) that behaves oddly with `-l` piped into other commands; use `command grep` to get standard GNU/BSD grep behavior when verifying results.
- Verified via multiple grep passes that all 596 `text-sm` and 350 `text-xs` occurrences were converted, and no stray occurrences remain in `app/` or `components/`.
