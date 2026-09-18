# F058: per-declaration error containment (blocker)

**Milestone:** M2 follow-ups
**Estimated worker time:** 25 minutes
**Depends on:** F014, F006

## Assertion IDs covered
- AS-057, AS-029

## Clarified implementation
(Inherited from F014)

## Follow-up scope (from M2-scrutiny-2.md — FU-M2-8)
Three fixes:

1. **Guard expandBorderRadius against empty/invalid values** in
   `lib/webflow-converter/longhand.ts`:
   - If `value` is empty/whitespace, return `{decls:{}, warning: "border-radius: empty value skipped"}`
   - If value starts with `/` (the `/ 4px` leading-slash form), return a warning
     "border-radius: leading-slash form not supported"
   - Only destructure `const [horiz, vert] = splitTop(value, /\//)` AFTER
     confirming value is non-empty and does not start with `/`

2. **Wrap per-declaration expansion in try/catch** at `css.ts:165` (the inner
   loop that calls `expandDeclaration`):
   - If `expandDeclaration` throws unexpectedly, catch the error and push a
     warning like `"unexpected error expanding '${prop}': ${err.message}"`
   - Continue processing remaining declarations — one bad decl must not abort
     the whole rule

3. **Handle postcss CssSyntaxError** at `css.ts:102` (`postcss.parse(cssText)`):
   - Catch `CssSyntaxError` and return a structured result:
     `{classes: new Map(), order: [], warnings: ["CSS parse error: <message>"]}`
   - Do NOT throw to the caller — `parseCss` must always return the result shape

## Definition of done
- `parseCss('.a{border-radius: ;}')` → returns a result (no throw); warnings
  includes something mentioning border-radius
- `parseCss('.a{border-radius: / 4px}')` → returns result with warning,
  no crash
- `parseCss('not valid css {{{{')` → returns `{classes: Map(), order: [],
  warnings: ["CSS parse error: ..."]}` (no throw)
- A declaration with any other expansion error → warning added, other
  declarations in the rule still processed
