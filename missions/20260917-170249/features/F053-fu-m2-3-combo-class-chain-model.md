# F053: model combo classes as chains not single comboOf string (AS-039/AS-040)

**Milestone:** M2 follow-ups
**Estimated worker time:** 35 minutes
**Depends on:** F012, F014

## Assertion IDs covered
- AS-039
- AS-040

## Clarified implementation
(Inherited from F012/F014)

## Follow-up scope (from M2-scrutiny.md — FU-M2-3)
Key the class map by the full chain, not by the terminal class name, so that `.b` and `.a.b` are distinct records that never share a declaration bucket and never mutate each other's linkage. Represent the chain as `string[]` (or a canonical key like `"a b"`) so `.a.b.c` retains both ancestors.

In practice for the Webflow XscpData format: combo classes ARE the terminal class name in Webflow — so the fix is to have SEPARATE entries: one for `b` (standalone), one for `b` with `comboOf: "a"`. These are different objects in the output, not merged.

The simplest correct model: use a compound key `"a\0b"` for combo rules so they don't collide with standalone `"b"` entries.

Add tests for: standalone-then-combo, combo-then-standalone (order independence), three-deep chains, same class under two different bases.

## Definition of done
- `.b{color:red} .a.b{color:blue}` produces TWO records: standalone b and combo b under a
- Order independent
- Three-deep chains preserve all ancestors
