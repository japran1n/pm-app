# Handoff: buildStyleBlock crash fix — style.type missing, combo comb format

## Status
COMPLETE

## Assertions covered
No new assertion IDs assigned to this task; this is a targeted bugfix to the
existing clipboard payload emission (AS-114, AS-116, AS-117 code paths) that
must continue to pass. All pre-existing assertion coverage in
lib/webflow-converter/{emit,validator,convert}.test.ts remains green after
the fix (555/555 tests pass).

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/validator.ts
lib/webflow-converter/emit.test.ts
lib/webflow-converter/validator.test.ts
lib/webflow-converter/convert.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run lib/webflow-converter/ components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts` (0, 555/555 passed)
`npm run lint` (0)

## Decisions made
- Confirmed root cause: Webflow Designer's `buildStyleBlock` reads
  `style.type` from every entry in `payload.styles`; our emitter never set
  it, so it was `undefined` and Designer threw `Invalid style type:
  undefined`. Added `type: "class"` as a required field on the
  `WebflowStyle` interface and set it on every style object we emit: the
  main per-class push, the synthesized combo stub, the `is-hidden` style,
  and the AS-114 leftover-class stub.
- Reordered the `WebflowStyle` interface fields to match Webflow's own
  clipboard field order (`_id, fake, type, name, namespace, comb, styleLess,
  variants, children, categories`) per the spec, kept `categories` (not
  called out for removal) at the end since it isn't part of the ordered
  list given but is still required by existing code (AS-116/AS-117 tests
  don't reference it).
- Changed combo classes' `comb` field to the literal `"&"` marker (Webflow's
  real clipboard format) instead of storing the base style's `_id`. Added a
  local `comboBaseById: Map<comboId, baseId>` populated during the first
  pass (both for the synthesized stub case and the normal combo-resolution
  case) so the second pass can still push the combo's `_id` into the
  resolved base's `children` array without reading it back out of `comb`.
- Updated `validator.ts`'s combo check: it no longer treats `style.comb` as
  a style id to look up. It now (a) errors if any style's `type !== "class"`
  (this is the actual crash guard), and (b) for any style with
  `comb === "&"`, scans all styles' `children` arrays and requires the
  combo's `_id` to appear in exactly one of them (0 owners = not registered
  error; 2+ owners = new "registered in more than one base" error, a
  stricter check than before but consistent with the single-parent
  invariant the base/children relationship is supposed to encode).
- Updated all `emit.test.ts` / `convert.test.ts` / `validator.test.ts`
  assertions that previously read `combo.comb === base._id` to instead
  assert `combo.comb === "&"` and `base.children.includes(combo._id)`
  (or the owners-array-length-1 pattern for the deeper multi-level combo
  chain tests). Added a new test
  `test_every_emitted_style_has_type_class` in emit.test.ts plus a new
  `AS-117: registered in more than one base` and a `crash regression: every
  style must carry type: "class"` case in validator.test.ts, both directly
  naming the crash this fixes.

## Out-of-scope work needed
None identified — the fix was scoped exactly to emit.ts/validator.ts and
their tests as directed. webflow-properties.ts was not touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `categories: []` in the `WebflowStyle` interface
and on every emitted object (not mentioned in the required field-order list
in the task, which stopped at `children`) since removing it would be an
undirected, out-of-scope schema change and nothing in the bug report
implicated it.

AUTONOMOUS_DECISION: For validator's new "combo registered in more than one
base" case, added it as a new error message rather than silently allowing
multiple owners, since a combo's base/children linkage is a strict
one-parent relationship in Webflow's model and letting it validate
successfully with an ambiguous parent could reintroduce clipboard-shape
bugs of the same flavor as this one.

## Notes for the next worker
- The crash reproduction path: build any payload via `emitWebflow`/`convert`
  with at least one class, feed it to `validatePayload`, then paste into
  Webflow Designer — that used to throw `Invalid style type: undefined at
  buildStyleBlock`. The new `type: "class"` field on every style plus the
  validator's `type === "class"` check should prevent this from ever
  regressing silently, since a style missing `type` will now fail
  validation (blocking the copy) instead of crashing Designer after paste.
- No MCP tools used — this is pure application logic with no live external
  service state involved.
