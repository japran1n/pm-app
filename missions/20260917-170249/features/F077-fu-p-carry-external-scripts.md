# F077: carry external scripts into custom code output (AS-101, AS-103, AS-110)

**Milestone:** M3 follow-ups round 1
**Depends on:** F019

## Clarified implementation (inherited from F019)

## Follow-up scope (from M3-scrutiny-1.md B-1)

`js-extract.ts:35-39` skips external `<script src>` tags and emits a warning. AS-103 is explicit: external `src` tags are "carried into the custom-code output unchanged, with no allowlist restriction and no stripping." The advisory warning may remain alongside the inclusion, but it must not replace it.

### Fix

In `extractScripts`, when encountering a `<script src="...">` tag:
1. Include the **original tag markup** (e.g. `<script src="https://cdn/gsap.js"></script>`) in the `scripts` array at source position (in order, not appended after inline scripts).
2. Emit an advisory warning alongside (not instead of) the inclusion.

```typescript
// Before (wrong):
if (script.getAttribute('src')) {
  warnings.push(`external script '...' not included — add manually`)
  continue
}

// After (correct):
if (src) {
  warnings.push(`external script '${src}' included in custom code — verify it loads correctly in Webflow`)
  scripts.push(script.outerHTML)  // carry verbatim
  continue
}
```

### Tests to add

- Interleaved inline and external scripts: `<script>A</script><script src="x.js"></script><script>B</script>` → `scripts` has length 3, in source order `["A", '<script src="x.js"></script>', "B"]`
- Warnings array has exactly 1 advisory for the external script
- A plain inline-only case still has 0 warnings

Update the existing test that currently asserts the external script is NOT in scripts — it asserts the wrong behavior.

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F077-handoff.md
Commit: "fix(AS-101,AS-103,AS-110): carry external scripts in source order; warning accompanies, not replaces"
