# F19 — Canvas integracija: chip na SitemapNode, board-level popover

**Status:** [CLARIFIED]
**Estimate:** 35 min
**Depends on:** F15 (toggle + detailsData prop on canvas-board), F17 (EstimateChip)

## Task

Integrisati procene u `canvas-board.tsx` — `SitemapNode` dobija estimate chip kada je `showDetails === true`.

## Pravila za canvas (obavezna, performance):

- `rollups` se računaju **jednom** — u `CanvasBoard` root komponenti pozivom `computeRollups(pages, detailsData)` kada `showDetails` postane `true`; prosleđuje se kao stabilan `Map` prop u `SitemapNode`
- `SitemapNode` ostaje memoizovan — dodavanje `rollups` prop-a ne ukida memoizaciju jer je mapa stabilna referenca
- `EstimateChip` je fiksne visine (h-5) da ne remeti `ResizeObserver` layout
- Nema novog per-node `useState`, context, niti per-node `useEffect`

## Izmene u `canvas-board.tsx`

### 1. Novi importi

```ts
import { computeRollups } from '@/lib/architecture/estimate-rollup';
import type { EstimateRollup } from '@/lib/architecture/estimate-rollup';
import { EstimateChip } from '@/components/architecture/estimate-chip';
```

### 2. Rollups computation

U `CanvasBoard` komponenti, dodati `useMemo`:

```ts
const rollups = useMemo(
  () => (showDetails && detailsData ? computeRollups(pages, detailsData) : null),
  [showDetails, detailsData, pages],
);
```

### 3. Prosleđivanje `rollups` u `nodeActions` ili direktno

`SitemapNode` prima props kroz `NodeActions` tip ili direktno. Dodaj `rollup?: EstimateRollup` u `SitemapNode`'s data ili kao kontekstualni prop. Najlakši put: prosledi `rollups` map u nodeActions kao `rollups?: Map<string, EstimateRollup>` i u `SitemapNode` uradi `actions.rollups?.get(node.page.id)`.

### 4. U `SitemapNode` renderu — dodaj chip ISPOD naslova stranice

Samo na čvorovima koji imaju `page.id` (stranice), ne na sekcijama (sekcije u canvas-u su unutar node-a stranice). Chip treba biti isti `<EstimateChip>` iz F17. Prikazati ga samo kada `rollup` postoji i `rollup.source !== 'none'`:

```tsx
{rollup && rollup.source !== 'none' && (
  <EstimateChip
    taskId={node.page.id}
    taskTitle={node.page.title}
    estimates={detailsData?.get(node.page.id)?.estimates ?? []}
  />
)}
```

Ovaj blok mora biti **fiksne visine** ili **se ne renderuje** (ne fluidan) da ne pokreće ResizeObserver relayout.

## Napomena o sekcijama

Sekcije u canvas-u se prikazuju unutar `SitemapNode` za svoju stranicu. Procena sekcija je dostupna kroz `<EstimateChip>` na `SectionCard` (F17) koji je već integrisan. U canvas-u sekcije koriste isti `SectionCard` — prosledi `showDetails` i `estimates` tamo.

## Definition of done

- [ ] `rollups` se računa jednom u `CanvasBoard` a ne po renderu
- [ ] Chip se prikazuje na canvas čvorovima stranica kada `showDetails === true` i postoje procene
- [ ] Chip se ne prikazuje kada `showDetails === false`
- [ ] Nema novih per-node state ili efekt poziva
- [ ] TypeScript build prolazi
