# F17 — `<EstimateChip>` na kartici sekcije

**Status:** [CLARIFIED]
**Estimate:** 25 min
**Depends on:** F15 (toggle), F16 (popover)

## Task

Dodati `<EstimateChip>` na `section-card.tsx` koji se prikazuje samo kad je `showDetails === true`.

## Nova komponenta `components/architecture/estimate-chip.tsx`

Kompaktan chip koji prikazuje ukupno za sekciju i otvara `DisciplineEstimatePopover`:

```tsx
"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { DisciplineEstimatePopover } from "@/components/architecture/discipline-estimate-popover";
import type { DisciplineEstimate } from "@/lib/architecture/types";

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function EstimateChip({
  taskId,
  taskTitle,
  estimates,
}: {
  taskId: string;
  taskTitle: string;
  estimates: DisciplineEstimate[];
}) {
  const [open, setOpen] = useState(false);
  const total = estimates.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 rounded px-1.5 font-mono text-xs tabular-nums text-muted-foreground hover:text-foreground"
          >
            {total > 0 ? formatMinutes(total) : "—"}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <DisciplineEstimatePopover
          taskId={taskId}
          taskTitle={taskTitle}
          estimates={estimates}
        />
      </PopoverContent>
    </Popover>
  );
}
```

## Izmena `section-card.tsx`

Dodati prop `showDetails?: boolean` i `estimates?: DisciplineEstimate[]` (import iz `@/lib/architecture/types`).

U render-u, unutar `<div className="absolute right-1 top-1 ...">` grupe ali LEVO od ostalih dugmadi (ili u zasebnom redu) — prikazati `<EstimateChip>` SAMO kad je `showDetails === true`:

```tsx
{showDetails && (
  <EstimateChip
    taskId={section.id}
    taskTitle={section.title}
    estimates={estimates ?? []}
  />
)}
```

Chip mora biti fiksne visine (h-5) da ne remeti layout.

## Definition of done

- [ ] `estimate-chip.tsx` postoji
- [ ] Chip pokazuje ukupno vreme (`font-mono text-xs tabular-nums`) ili `—` kad nema procene
- [ ] Klik otvara `DisciplineEstimatePopover`
- [ ] U `section-card.tsx` chip se ne renderuje kada `showDetails !== true`
- [ ] TypeScript build prolazi
