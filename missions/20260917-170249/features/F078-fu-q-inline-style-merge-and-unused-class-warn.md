# F078: merge inline <style> CSS into style model; warn on unused classes (AS-089, AS-051)

**Milestone:** M3 follow-ups round 1
**Depends on:** F021

## Clarified implementation (inherited from F021)

## Follow-up scope (from M3-scrutiny-1.md B-3, B-8)

### Problem 1: inline `<style>` CSS lost from convert() (AS-089)

`convert.ts:31-45` extracts body `<style>` content into `customCode.styles` but never passes it to `parseCss`. Only `convertFromSource` merges them — and it ignores the `css` argument entirely, so there's no path combining a CSS argument with inline `<style>` blocks.

### Fix 1: merge inline styles before parseCss

In `convert(html, css)`:
1. Extract `<style>` block text from `html` using `extractStyles(html).styles`
2. Concatenate with the `css` argument: `const fullCss = [css, ...inlineStyles].join('\n')`
3. Pass `fullCss` to `parseCss`
4. Remove the `customCode.styles` field — inline CSS is now in the style model, not custom code

Make `convertFromSource(html)` a thin wrapper: `return convert(html, '')` — not a divergent implementation.

### Problem 2: no defined-but-unreferenced class warning (AS-051)

After `emitWebflow`, we have:
- The set of class names used by nodes (from the emit output)
- The set of class names defined in parseCss output

Diff them and warn for each defined-but-unreferenced class:

```typescript
const usedClasses = new Set(payload.payload.nodes.flatMap((n: any) => n.classes ?? []))
for (const [cls] of cssResult.classes) {
  if (!usedClasses.has(cls)) {
    warnings.push(`CSS class "${cls}" is defined but not used by any HTML element`)
  }
}
```

### Tests to add

- `<style>.inline-only{color:red}</style><div class="inline-only"></div>` with no css arg → `.inline-only` appears in styles
- `convert('<div class="used">', '.used{color:red} .unused{display:block}')` → warnings includes "CSS class "unused" is defined but not used"
- `convertFromSource` still works for a self-contained HTML with inline styles
- Combining a css argument AND inline `<style>` blocks: both resolve into styles

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F078-handoff.md
Commit: "fix(AS-089,AS-051): merge inline style CSS into style model; warn on unused classes"
