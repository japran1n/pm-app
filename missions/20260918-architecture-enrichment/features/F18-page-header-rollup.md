# F18 — Rollup zbir i oznaka izvora u `page-column-header.tsx`

**Status:** [CLARIFIED]
**Estimate:** 30 min
**Depends on:** F06 (computeRollups), F15 (toggle)

## Task

Proširiti `page-column-header.tsx` da prikazuje efektivni zbir procene i oznaku izvora — samo kada je `showDetails === true`.

## Novi propsi

```ts
showDetails?: boolean;
rollup?: import('@/lib/architecture/estimate-rollup').EstimateRollup;
```

## Izmene u render-u (u headeru stranice, ispod naslova)

Dodati kondicionalni blok SAMO kada `showDetails && rollup`:

```tsx
{showDetails && rollup && rollup.source !== 'none' && (
  <div className="flex items-center gap-1.5 pt-0.5">
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {rollup.source === 'rolled' && 'Σ '}
      {formatMinutes(rollup.total)}
    </span>
    {rollup.source === 'rolled' && (
      <span className="text-xs text-muted-foreground/60">
        ({page.sections.length} sections)
      </span>
    )}
    {rollup.conflicts && (
      <span
        className="text-xs text-muted-foreground/60"
        title={`Sections total: ${formatMinutes(rollup.sectionsTotal)}`}
      >
        · sections {formatMinutes(rollup.sectionsTotal)}
      </span>
    )}
  </div>
)}
```

Gdje `formatMinutes` je ista helper funkcija kao u chip-u (može se exportovati iz `lib/architecture/estimate-rollup.ts` ili biti lokalna kopija).

## Definition of done

- [ ] `page-column-header.tsx` prihvata opcionalne `showDetails` i `rollup` propse
- [ ] Zbir i oznaka izvora prikazani samo kad `showDetails === true` i rollup postoji
- [ ] `Σ` prefiks za rollup iz sekcija, bez prefiksa za sopstvenu procenu
- [ ] `conflicts` prikazuje red "sections X" ispod
- [ ] TypeScript build prolazi
