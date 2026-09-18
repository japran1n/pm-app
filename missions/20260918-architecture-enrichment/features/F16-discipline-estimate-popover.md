# F16 — `<DisciplineEstimatePopover>` komponenta

**Status:** [CLARIFIED]
**Estimate:** 40 min
**Depends on:** F12 (estimates actions), F15 (toggle)

## Task

Napravi `components/architecture/discipline-estimate-popover.tsx` — popover za unos/izmenu procene po disciplini za jedan čvor (stranicu ili sekciju).

## Dizajn

5 redova (jedan po disciplini), svaki sa:
- Labela (Design, Development, Content & SEO, PM, QA)
- Input polje za unos (`"2h 30m"`, `"90m"`, `"1.5h"`) sa live zbir ispod
- X dugme za brisanje ako postoji procena
- Živim zbirom naviše (prikazati ukupno u popover headeru)

## Implementacija

```tsx
'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { setDisciplineEstimate, clearDisciplineEstimate } from '@/lib/actions/architecture';
import { parseEstimateInput } from '@/lib/validation/architecture';
import type { DisciplineEstimate, WorkCategory } from '@/lib/architecture/types';
import { WORK_CATEGORIES } from '@/lib/architecture/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DISCIPLINE_LABELS: Record<WorkCategory, string> = {
  design: 'Design',
  development: 'Development',
  content_seo: 'Content & SEO',
  pm: 'PM',
  qa: 'QA',
};

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function DisciplineEstimatePopover({
  taskId,
  taskTitle,
  estimates,
  onClose,
}: {
  taskId: string;
  taskTitle: string;
  estimates: DisciplineEstimate[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const estimateByDiscipline = new Map(estimates.map(e => [e.discipline, e]));
  
  // Local state: string input per discipline
  const [inputs, setInputs] = useState<Partial<Record<WorkCategory, string>>>(() => {
    const init: Partial<Record<WorkCategory, string>> = {};
    for (const e of estimates) {
      init[e.discipline] = formatMinutes(e.minutes);
    }
    return init;
  });
  const [errors, setErrors] = useState<Partial<Record<WorkCategory, string>>>({});
  const [isPending, startTransition] = useTransition();

  function getTotal(): number {
    let total = 0;
    for (const d of WORK_CATEGORIES) {
      const val = inputs[d];
      if (val) {
        const m = parseEstimateInput(val);
        if (m !== null) total += m;
      }
    }
    return total;
  }

  function handleSave(discipline: WorkCategory) {
    const input = inputs[discipline];
    if (!input || !input.trim()) {
      // Clear
      startTransition(async () => {
        const result = await clearDisciplineEstimate(taskId, discipline);
        if (result.success) {
          router.refresh();
        } else {
          toast.error(result.error ?? 'Something went wrong');
        }
      });
      return;
    }
    const minutes = parseEstimateInput(input);
    if (minutes === null) {
      setErrors(prev => ({ ...prev, [discipline]: 'Use "2h 30m", "90m", or "1.5h"' }));
      return;
    }
    setErrors(prev => ({ ...prev, [discipline]: undefined }));
    startTransition(async () => {
      const result = await setDisciplineEstimate(taskId, discipline, input);
      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error ?? 'Something went wrong');
      }
    });
  }

  const total = getTotal();

  return (
    <div className="flex min-w-[260px] flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium truncate max-w-[180px]">{taskTitle}</p>
        {total > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatMinutes(total)} total
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {WORK_CATEGORIES.map(d => (
          <div key={d} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-xs text-muted-foreground">
                {DISCIPLINE_LABELS[d]}
              </label>
              <Input
                className="h-7 text-xs font-mono"
                placeholder="—"
                value={inputs[d] ?? ''}
                disabled={isPending}
                onChange={e => {
                  setInputs(prev => ({ ...prev, [d]: e.target.value }));
                  setErrors(prev => ({ ...prev, [d]: undefined }));
                }}
                onBlur={() => handleSave(d)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSave(d); }
                }}
              />
              {estimateByDiscipline.has(d) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0"
                  disabled={isPending}
                  onClick={() => {
                    setInputs(prev => ({ ...prev, [d]: '' }));
                    startTransition(async () => {
                      const result = await clearDisciplineEstimate(taskId, d);
                      if (result.success) router.refresh();
                      else toast.error(result.error ?? 'Something went wrong');
                    });
                  }}
                >
                  <X size={12} />
                </Button>
              )}
            </div>
            {errors[d] && (
              <p className="pl-[120px] text-xs text-destructive">{errors[d]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Definition of done

- [ ] Komponenta postoji u `components/architecture/discipline-estimate-popover.tsx`
- [ ] Sve 5 disciplina prikazane
- [ ] Blur/Enter poziva server action
- [ ] Live zbir u headeru (`font-mono text-xs tabular-nums`)
- [ ] X dugme briše procenu
- [ ] Nema novih senki, nema hex boja
- [ ] TypeScript build prolazi
