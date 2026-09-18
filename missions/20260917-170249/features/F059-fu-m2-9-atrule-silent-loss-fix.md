# F059: at-rules must never disappear silently (blocker)

**Milestone:** M2 follow-ups
**Estimated worker time:** 30 minutes
**Depends on:** F054

## Assertion IDs covered
- AS-057

## Clarified implementation
(Inherited from F014)

## Follow-up scope (from M2-scrutiny-2.md — FU-M2-9)
Two fixes in `lib/webflow-converter/css.ts`:

1. **Nested atrule children inside rules** — the inner loop at `css.ts:163`
   currently handles only `type === "decl"` and `type === "rule"`. Add a branch
   for `type === "atrule"` children:
   - If it is a media atrule with a mappable breakpoint, EITHER hoist its
     declarations into the correct variant bucket (preferred), OR emit a warning
     "nested @media in .X: not supported — declarations skipped" and continue
   - For all other nested atrule children, emit the warning and skip
   - Either way, declarations must NEVER vanish without a warning

2. **Unknown top-level at-rules** — `css.ts:124–140` dispatches on at-rule name
   (`media`, `supports`, `layer`, `keyframes`, `font-face`). Every other name
   hits a bare `return`. Add a catch-all `else` branch that emits:
   `"@<name> is not supported — N rule(s) skipped"` before returning. This
   covers `@container`, `@scope`, `@page`, `@import`, `@property`,
   `@counter-style`, and any future additions.

## Definition of done
- `.a{color:red; @media (max-width:767px){color:blue}}` → warnings includes
  something about nested @media; color:blue does NOT vanish silently
- `@container (max-width:500px){ .a{color:red} }` → warnings includes
  "@container is not supported"
- `@page{margin:1cm}` → warnings includes "@page is not supported"
- `@import url(x.css);` → warnings includes "@import is not supported"
- All existing tests in css.test.ts still pass
