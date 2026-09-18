# F084: fix pseudo-state variant mapping — placeholder slot + breakpoint+state collision (AS-041)

**Milestone:** M3 follow-ups round 2
**Depends on:** F076

## Follow-up scope (from M3-scrutiny-2.md B-1)

Two bugs in emit.ts's pseudo-state handling:

### Bug 1: `::placeholder` maps to wrong Webflow slot

`emit.ts` maps `placeholder: "nthChild"` — placeholder styles are placed into nth-child, which is completely wrong. Webflow does not have a dedicated placeholder slot; the correct behavior is to emit a warning and skip it (same as `:visited`, `::before`, `::after`).

**Fix:** Remove `placeholder` from the `PSEUDO_STATE_TO_WEBFLOW` map. Let it fall through to the "does not map to a Webflow state — skipped" warning path.

AS-041 lists exactly 8 states. Check the validation contract for the authoritative list. Any state not in that list gets a warning + skip. Do NOT add new slots without confirming against Webflow's actual clipboard schema.

### Bug 2: breakpoint+state collision loses styles

`emit.ts:129-135` (approximately) processes variant keys. When both `hover` and `medium_hover` exist, the second one overwrites the first in the same slot — so the default-breakpoint `:hover` is lost.

The correct structure: each Webflow style's `variants` map should be keyed by the breakpoint, and within each breakpoint, each state gets its own slot. But Webflow's actual `styleLess` for a breakpoint carries ALL declarations for that breakpoint, not just hover.

Looking at the emit.ts variant shape: variants are keyed by breakpoint (`medium`, `small`, `tiny`). Each breakpoint entry has its own `styleLess`. Pseudo-state variants at the DEFAULT breakpoint go into a top-level `hover`/`focused`/`pressed` key on the style object (not nested under a breakpoint).

**Fix:** When processing `"medium_hover"` or similar composite keys:
- Strip the state suffix, identify the breakpoint
- Add the declarations to the breakpoint's existing `styleLess`, not to the state slot
- Emit a warning: "`:hover` inside `@media` blocks is not supported in Webflow's class editor — declarations moved to breakpoint styles"

This is the practical correct behavior: Webflow doesn't support per-breakpoint hover overrides in its class editor.

### Tests to add

- `::placeholder` rule → no slot in variants, warning emitted
- `.btn:hover` at default + `.btn:hover` inside `@media (max-width:991px)` → default hover slot present, medium breakpoint styleLess also updated, no loss
- Each of the 8 AS-041 states that Webflow supports: assert correct slot key
- States Webflow doesn't support (`:visited`, `::before`, `::after`, `::placeholder`): assert warning emitted, no crash

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F084-handoff.md
Commit: "fix(AS-041): fix placeholder slot, prevent breakpoint+state collision in variant mapping"
