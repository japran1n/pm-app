# F057: make AS-069 self-auditing with independent shorthand vocabulary (blocker)

**Milestone:** M2 follow-ups
**Estimated worker time:** 30 minutes
**Depends on:** F051

## Assertion IDs covered
- AS-069

## Clarified implementation
(Inherited from F011)

## Follow-up scope (from M2-scrutiny-2.md — FU-M2-7)
The current guard only fires for properties already in `SHORTHANDS`, so the
set's incompleteness is the vulnerability. Fix:

1. Add a static `EXTRA_SHORTHANDS` set (or expand `SHORTHANDS`) in
   `lib/webflow-converter/longhand.ts` covering at minimum:
   `text-decoration`, `columns`, `mask`, `border-image`, `offset`,
   `text-emphasis`, `scroll-margin`, `scroll-padding`, `grid-column`,
   `grid-row`, `all`, `container`, `text-wrap`, `margin-inline`,
   `margin-block`, `padding-inline`, `padding-block`, `inset-inline`,
   `inset-block`, `border-inline`, `border-block`.

2. The `default:` branch in `expandDeclaration` already warns-and-drops when
   `isShorthand(prop)`. After adding these properties to the SHORTHANDS set
   (so `isShorthand()` returns true for them), the branch will fire correctly.

3. Rewrite the AS-069 test in `lib/webflow-converter/longhand.test.ts` so
   its corpus is the `SHORTHANDS` set from the module BUT the test also
   verifies each property in a hardcoded independent list (the same list
   above). The test must fail if a property from the independent list is
   absent from SHORTHANDS — this is the only way the test can ever catch
   a missing entry.

## Definition of done
- `parseCss('.card{text-decoration:underline dotted red}')` → warnings includes
  "shorthand 'text-decoration' is not supported"; base does NOT contain
  text-decoration
- Same for `columns`, `mask`, `all`, `grid-column`, and at least one logical
  property family (`margin-inline`, `padding-block`, etc.)
- The AS-069 test contains an independent corpus; removing a property from
  SHORTHANDS causes the test to fail
