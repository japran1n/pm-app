# F080: wire type field from emit envelope into validatePayload (AS-111 end-to-end)

**Milestone:** M3 follow-ups round 1
**Depends on:** F075, F076

## Clarified implementation (inherited from F021)

## Follow-up scope (from F075-handoff.md PARTIAL)

`convert.ts` calls `validatePayload(emitResult.payload.payload)` — passing only the inner payload, not the outer envelope. `emit.ts` (F076) now stamps `type: "@webflow/XscpData"` on the outer object. So `validatePayload` never sees the `type` field and flags every real conversion as invalid (AS-111 check fails for well-formed input), causing 9 `convert.test.ts` failures.

### Fix

In `lib/webflow-converter/convert.ts`, find the call to `validatePayload` and change it to pass the full envelope:

```typescript
// Before:
const validation = validatePayload(emitResult.payload.payload)

// After:
const validation = validatePayload(emitResult.payload)
```

AND update `validatePayload`'s signature in `validator.ts` to accept the full `XscpData` envelope (i.e. `{ type: string, payload: XscpPayload }`) and read `input.type` directly instead of the duck-typed `(payload as { type?: unknown }).type` workaround. Then update internal references from `payload.nodes` / `payload.styles` to `payload.payload.nodes` / `payload.payload.styles`.

If changing the signature is too invasive (many internal references), the minimal alternative is:

```typescript
const validation = validatePayload({ ...emitResult.payload.payload, type: emitResult.payload.type })
```

Either approach is acceptable — choose whichever keeps the code clearest.

### After the fix

All 9 currently-failing `convert.test.ts` tests should go green. Run the full suite:

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F080-handoff.md
Commit: "fix(AS-111): wire type envelope from emit into validatePayload; 9 convert tests green"
