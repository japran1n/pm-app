# F20 — `<EstimateSummary>` komponenta

**Status:** [CLARIFIED]
**Estimate:** 45 min
**Depends on:** F06 (computeRollups), F15 (toggle + detailsData)

## Task

Napravi `components/architecture/estimate-summary.tsx` — prikazuje se IZNAD board-a/canvas-a samo kada je `showDetails === true`.

## Props

```ts
{
  pages: BoardPage[];
  detailsData: ArchitectureNodeDetails;
  projectId: string;
}
```

## Sadržaj

### Zaglavlje sajta (site totals)

Za svih 5 disciplina prikaži: ukupno procenjeno vs. ukupno logovano (ako je dostupno) u `font-mono text-xs tabular-nums` tabelarnom redu:

```tsx
<div className="flex flex-wrap gap-4">
  {WORK_CATEGORIES.map(d => {
    const estimated = siteTotals[d] ?? 0;
    return estimated > 0 ? (
      <div key={d} className="flex flex-col gap-0.5">
        <p className="text-xs text-muted-foreground capitalize">{DISCIPLINE_LABELS[d]}</p>
        <p className="font-mono text-sm tabular-nums">{formatMinutes(estimated)}</p>
      </div>
    ) : null;
  })}
</div>
```

### Tabela po stranicama

| Stranica | Design | Dev | Content | PM | QA | Total | Source | 
|----------|--------|-----|---------|----|----|-------|--------|

Za svaki red: naslov stranice, procena po disciplini (ili `—`), ukupno, oznaka izvora (`rolled`/`own`). Crveni tekst ako nema procene ali postoji rollup sa konfliktom.

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b text-left text-muted-foreground">
        <th className="py-1.5 pr-4 font-medium">Page</th>
        {WORK_CATEGORIES.map(d => (
          <th key={d} className="py-1.5 pr-3 font-mono font-medium tabular-nums">
            {DISCIPLINE_LABELS[d]}
          </th>
        ))}
        <th className="py-1.5 pr-3 font-mono font-medium tabular-nums">Total</th>
        <th className="py-1.5 font-medium">Source</th>
      </tr>
    </thead>
    <tbody>
      {pages.map(page => {
        const rollup = rollups.get(page.id);
        if (!rollup || rollup.source === 'none') return null;
        return (
          <tr key={page.id} className="border-b last:border-0">
            <td className="py-1.5 pr-4">{page.title}</td>
            {WORK_CATEGORIES.map(d => (
              <td key={d} className="py-1.5 pr-3 font-mono tabular-nums text-muted-foreground">
                {rollup.byDiscipline[d] ? formatMinutes(rollup.byDiscipline[d]!) : '—'}
              </td>
            ))}
            <td className="py-1.5 pr-3 font-mono tabular-nums font-medium">
              {formatMinutes(rollup.total)}
            </td>
            <td className="py-1.5 text-muted-foreground">
              {rollup.source === 'rolled' ? 'Σ sections' : 'own'}
              {rollup.conflicts && (
                <span className="ml-1 text-destructive" title="Own estimate differs from sections total">!</span>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>
```

## Integracija u `architecture-view-toggle.tsx`

Wrapper iznard board/canvas view-a:

```tsx
{showDetails && detailsData && (
  <EstimateSummary
    pages={pages}
    detailsData={detailsData}
    projectId={projectId}
  />
)}
```

Importovati `EstimateSummary` u `architecture-view-toggle.tsx`.

## Definition of done

- [ ] Komponenta montira se samo kada `showDetails === true` u toggle
- [ ] Prikazuje ukupno po disciplini za ceo sajt
- [ ] Tabela po stranicama sa kolonama za disciplinu i totalnim
- [ ] `font-mono tabular-nums` za sve brojeve
- [ ] Nema novih upita — podataci dolaze iz `detailsData` koja je već fetch-ovana
- [ ] TypeScript build prolazi
