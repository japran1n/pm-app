# F067: final longhand.ts fixes — border parsing, AS-069 whitelist, transition/font, AS-135

**Milestone:** M2 follow-ups
**Depends on:** F063

## Fixes needed in lib/webflow-converter/longhand.ts and longhand.test.ts

### Fix 1 (FU-B, blocker AS-055): parseBorderParts token classification
Current bug: parseBorderParts fills slots positionally, so `border:1px 2px solid` puts '2px' in color.
Fix: Classify each token by KIND, not position:
- Width: token === '0', or has length unit (px/em/rem/%), or is 'thin'/'medium'/'thick'
- Style: the CSS border-style keywords set ('none','hidden','dotted','dashed','solid','double','groove','ridge','inset','outset','auto')
- Color: everything else (named color, hex, rgb(), hsl(), var(), etc.)

If token is var() — drop entire declaration with warning "border: var() shorthand not supported — write longhands instead" (return {decls:{}, warning:...})

If a slot is already filled when a second token of the same kind arrives — warn about the extra token and skip it.

Add tests:
- `border:1px 2px solid` → warning about '2px' (extra width or unclassifiable), no garbage color
- `border:var(--w) solid red` → warning about var(), empty decls (not garbage output)
- `border:0 solid red` → width:'0', style:'solid', color:'red' on all 4 sides
- `border:0` → width:'0' on all 4 sides

### Fix 2 (FU-C, blocker AS-069): resolve SHORTHANDS/PASS_THROUGH contradiction
In longhand.ts:
- `grid-column`, `grid-row`, `grid-area` are in BOTH SHORTHANDS and PASS_THROUGH
- Decision: Webflow DOES accept these as properties. Remove them from SHORTHANDS (the expansion switch cases) if there are dead case branches for them, OR remove them from PASS_THROUGH if they genuinely need to be blocked.
- Read the code to understand which switch cases handle grid-column/row/area. If there are case branches in the switch that expand them (unlikely since they have no real expander), remove those cases. Keep them in PASS_THROUGH.
- If SHORTHANDS set (not switch cases) contains these: remove from SHORTHANDS set.

Add missing properties to EXTRA_SHORTHANDS:
- `white-space`, `overflow-block`, `overflow-inline`, `scroll-margin-block`, `scroll-margin-inline`

Remove from EXTRA_SHORTHANDS (it's actually a longhand Webflow accepts):
- `grid-template-areas` — this is a longhand property, not a shorthand. Remove it from EXTRA_SHORTHANDS so it passes through.

### Fix 3 (AS-135, major): guard against empty shorthandProperties import
In the AS-069 test in longhand.test.ts that does `Object.keys(shorthandProperties).forEach(...)`:
Add BEFORE the loop: `expect(Object.keys(shorthandProperties).length).toBeGreaterThan(0)`
This catches the case where the import silently resolved to {} and the loop ran 0 iterations.

### Fix 4 (FU-D, major AS-063): transition unparseable time → drop item not 0s
In expandTransition, when a duration/delay cannot be parsed (e.g. var(--d)), the item currently gets '0s' as a default. Instead, drop the entire transition item with a warning:
"transition: unresolvable time value 'var(--d)' — item dropped"
Return empty decls for that item (or omit transition-duration rather than defaulting to 0s).

### Fix 5 (FU-D, major AS-065): expandFont font-stretch keywords
Add recognition of font-stretch keywords ('condensed','expanded','ultra-condensed','extra-condensed','semi-condensed','semi-expanded','extra-expanded','ultra-expanded') in the expandFont prelude parsing. When found, emit `font-stretch: 'condensed'` and continue parsing. If not recognized, warn "font: unrecognized font-stretch value — font-family may be incorrect".

## Run after all fixes
Run: npx vitest run lib/webflow-converter/longhand.test.ts
Run: npx vitest run lib/webflow-converter/ (all 4 files — MUST be 213+ tests, 0 failed)
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F067-handoff.md
Commit: "fix(AS-055,AS-069,AS-063,AS-065,AS-135): border parsing, whitelist fixes, transition/font"
