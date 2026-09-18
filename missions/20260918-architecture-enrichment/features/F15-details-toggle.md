# F15 — "Details" toggle u `architecture-view-toggle.tsx`

**Status:** [CLARIFIED]
**Estimate:** 30 min
**Depends on:** F09 (getNodeDetailsForToggle action)

## Task

Dodati treće "Details" dugme u `components/architecture/architecture-view-toggle.tsx`, sa `localStorage` perzistencijom i lazy fetch-om detalja pri prvom uključivanju.

## Tačne izmene

### 1. Novi importi

```ts
import { useEffect, useCallback } from "react";
import { SlidersHorizontal } from "lucide-react";
import { getNodeDetailsForToggle } from "@/lib/actions/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
```

### 2. Novi state (unutar komponente, ISPOD `const [view, setView] = useState<ViewMode>("canvas")`)

```ts
const [showDetails, setShowDetails] = useState(false);
const [detailsData, setDetailsData] = useState<ArchitectureNodeDetails | null>(null);
const [detailsLoading, setDetailsLoading] = useState(false);

// localStorage key per project
const storageKey = `pm-app:architecture-details:${projectId}`;

// Load persisted showDetails on mount
useEffect(() => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'true') {
      setShowDetails(true);
      // Don't fetch here — let the toggle handler do it on first enable
      // Actually: if it was persisted as true, fetch immediately
      handleEnableDetails();
    }
  } catch {
    // localStorage may be unavailable in some environments
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Actually, use a simpler pattern — a single `useEffect` that fetches when `showDetails` becomes true and `detailsData` is null:

```ts
const [showDetails, setShowDetails] = useState(() => {
  try {
    return localStorage.getItem(`pm-app:architecture-details:${projectId}`) === 'true';
  } catch {
    return false;
  }
});
const [detailsData, setDetailsData] = useState<ArchitectureNodeDetails | null>(null);
const [detailsLoading, setDetailsLoading] = useState(false);

// Fetch details when toggle turns on, but only once per session
useEffect(() => {
  if (!showDetails || detailsData !== null) return;
  let cancelled = false;
  setDetailsLoading(true);
  getNodeDetailsForToggle(projectId).then(result => {
    if (cancelled) return;
    setDetailsLoading(false);
    if (result.ok) setDetailsData(result.data);
  });
  return () => { cancelled = true; };
}, [showDetails, detailsData, projectId]);

function toggleDetails() {
  const next = !showDetails;
  setShowDetails(next);
  try {
    localStorage.setItem(`pm-app:architecture-details:${projectId}`, String(next));
  } catch {}
}
```

### 3. Treće dugme (dodati u toggle group, POSLE Network dugmeta)

```tsx
{/* Separator */}
<div className="mx-0.5 h-4 w-px bg-border" />
<button
  type="button"
  onClick={toggleDetails}
  title={showDetails ? "Hide details" : "Show estimates & copy brief"}
  disabled={detailsLoading}
  className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
    showDetails
      ? "bg-background text-foreground shadow-xs"
      : "text-muted-foreground hover:text-foreground"
  } disabled:opacity-50`}
>
  {detailsLoading
    ? <Loader2 size={14} className="animate-spin" />
    : <SlidersHorizontal size={14} />
  }
</button>
```

### 4. Pass `showDetails` i `detailsData` ka board/canvas komponentama

Prosledi oba kao props do `ArchitectureBoard` i `CanvasBoard` (biće ignorisani dok M5 ostale feature ne implementuju prikazivanje — ali props kontrakt mora biti tačan):

```tsx
{view === "board" ? (
  <ArchitectureBoard
    pages={pages}
    components={components}
    projectId={projectId}
    showDetails={showDetails}
    detailsData={detailsData}
  />
) : (
  <CanvasBoard
    pages={pages}
    components={components}
    projectId={projectId}
    projectName={projectName}
    showDetails={showDetails}
    detailsData={detailsData}
  />
)}
```

**IMPORTANT**: `ArchitectureBoard` i `CanvasBoard` ne primaju ove propse još — dodaj ih kao opcionalne (`showDetails?: boolean`, `detailsData?: ArchitectureNodeDetails | null`) u njihovim prop tipovima da TypeScript prođe. Ne implementiraj prikaz u njima — samo dodaj opcionalne propse.

## Definition of done

- [ ] Treće dugme sa `SlidersHorizontal` ikonicom postoji u toggle grupi
- [ ] `showDetails` inicializuje se iz `localStorage` (default false na novom projektu/browseru)
- [ ] Fetch se poziva jednom pri prvom uključivanju, ne ponavlja pri ponovnom uključivanju u istoj sesiji
- [ ] Dugme pokazuje `Loader2` spinner dok se detalji učitavaju
- [ ] `localStorage` se ažurira na svaki toggle
- [ ] `ArchitectureBoard` i `CanvasBoard` primaju opcionalne `showDetails`/`detailsData` propse (ne prikazuju ništa novo još)
- [ ] TypeScript build prolazi
- [ ] Portala: `client-board.tsx` se ne menja — portal ne dobija toggle
