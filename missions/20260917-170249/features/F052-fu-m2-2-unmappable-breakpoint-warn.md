# F052: unmappable viewport widths must warn not snap (AS-048)

**Milestone:** M2 follow-ups
**Estimated worker time:** 20 minutes
**Depends on:** F013

## Assertion IDs covered
- AS-048

## Clarified implementation
(Inherited from F013)

## Follow-up scope (from M2-scrutiny.md — FU-M2-2)
Change `mapBreakpoint` in lib/webflow-converter/breakpoints.ts to return `null` when a max-width or min-width value does not equal one of Webflow's exact viewport boundaries (479/767/991 and 1440/1920/2560), rather than falling back to `medium`/`large`. AS-048 says "produces a warning and its rules are skipped" — skipping is the contract-conformant choice.

Update `css.ts` to treat null from mapBreakpoint as "skip this @media block" + add warning.

Fix the mirror tests in breakpoints.test.ts that currently assert the fallback is correct. Add parseCss-level cases proving `@media (max-width:1200px)` yields a warning and zero classes.

## Definition of done
- @media with non-Webflow width produces warning and no output classes
- Webflow exact widths (479/767/991/1440/1920/2560) still map correctly
- Old fallback tests deleted/updated
