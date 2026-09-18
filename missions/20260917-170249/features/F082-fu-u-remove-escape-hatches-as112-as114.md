# F082: remove allowEmptyNodes and fakeStyles escape hatches (AS-112, AS-114)

**Milestone:** M3 follow-ups round 2
**Depends on:** F081

## Follow-up scope (from M3-scrutiny-2.md B-3, B-4)

Two escape hatches in convert.ts bypass validator rules and return invalid payloads:

### Escape hatch 1: allowEmptyNodes (AS-112)

`convert("", "")` returns `errors: []` with `nodes: []` because `convert.ts:85` sets `allowEmptyNodes: true` and `validator.ts:190` skips the check. AS-112 is clear: "Every successfully converted payload's node list is non-empty."

**Fix:**
1. Delete the `allowEmptyNodes` option from `validator.ts` — remove the parameter, the `opts` argument, and the conditional skip.
2. Delete `convert.ts`'s `allowEmptyNodes` call site.
3. Delete `convert.test.ts:30-38` ("empty HTML string returns an empty (not null/undefined) valid payload") — this test asserts the inverse of AS-112. Replace it with a test asserting `convert("", "")` returns `payload: null` and `errors` containing "must not be empty" (or similar).

### Escape hatch 2: fakeStyles (AS-114)

`convert.ts:69-89` builds synthetic `fake: true` styles for unresolved class names, validates against the augmented payload, then returns the real (unaugmented) payload — so the caller gets a payload whose nodes reference classes with no matching style. This is exactly what AS-114 forbids. It also causes inconsistent behavior: same-class at depth 0 succeeds, at depth 1 fails (because fakeStyles doesn't recurse).

**Fix:**
1. Delete the `fakeStyles` block entirely from `convert.ts` (lines ~69-89 or wherever it is after recent edits).
2. Let `validatePayload` run on the real payload as-is. If nodes reference classes with no CSS, `errors` will contain the AS-114 message and `payload` will be null.
3. The existing `validator.ts` AS-114 check already works correctly for this case.
4. Update or delete convert.test.ts tests that assert "HTML without CSS converts successfully" where the HTML contains elements with class names — those should now fail validation. Tests with class-free HTML (`<div></div>` etc.) are fine.

### Tests to add after fixes

- `convert("", "")` → `payload: null`, `errors.length > 0`, errors includes "must not be empty"  
- `convert('<!-- comment -->', '')` → same (consistent behavior)
- `convert('<div class="ghost"></div>', '')` → `payload: null` (AS-114: unresolved class)
- `convert('<div class="outer"><p class="ghost">x</p></div>', '')` → `payload: null` (consistent with depth 0)
- `convert('<div></div>', '')` → valid (no classes, empty element is fine, but nodes.length check... wait: this has 1 node so AS-112 passes)

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F082-handoff.md
Commit: "fix(AS-112,AS-114): remove allowEmptyNodes and fakeStyles escape hatches; enforce contract"
