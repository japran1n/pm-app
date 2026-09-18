# F07 — Validation schemas za architecture enrichment

**Status:** [CLARIFIED]
**Estimate:** 25 min

## Task

Dodaj Zod sheme u `lib/validation/architecture.ts` (fajl već postoji — proširi ga, ne pravi novi).

## Sheme za dodati

```ts
// Provjeri da li workCategorySchema već postoji u fajlu.
// Ako ne postoji, dodaj:
export const workCategorySchema = z.enum(['design', 'development', 'content_seo', 'pm', 'qa']);

// Estimate input — korisnik unosi "2h 30m", "90m", "1.5h" itd.
export const estimateInputSchema = z.string().min(1).max(50);

// Za server action — parsed minutes
export const estimateMinutesSchema = z.number().int().min(1, 'Estimate must be at least 1 minute');

// setDisciplineEstimate payload
export const setDisciplineEstimateSchema = z.object({
  taskId: z.string().uuid(),
  discipline: workCategorySchema,
  input: estimateInputSchema, // raw string, parsed to minutes in the action
  note: z.string().max(500).optional(),
});

// setDisciplineEstimatesBulk entry
export const disciplineEstimateEntrySchema = z.object({
  discipline: workCategorySchema,
  input: estimateInputSchema,
  note: z.string().max(500).optional(),
});

export const setDisciplineEstimatesBulkSchema = z.object({
  taskId: z.string().uuid(),
  entries: z.array(disciplineEstimateEntrySchema).min(1).max(5),
});

// clearDisciplineEstimate
export const clearDisciplineEstimateSchema = z.object({
  taskId: z.string().uuid(),
  discipline: workCategorySchema,
});

// setNodeMeta patch
export const copyStatusSchema = z.enum(['not_started', 'brief_ready', 'drafted', 'in_review', 'approved']);

export const setNodeMetaSchema = z.object({
  taskId: z.string().uuid(),
  patch: z.object({
    intent: z.string().max(1000).optional(),
    audience: z.string().max(500).optional(),
    primaryCta: z.string().max(200).optional(),
    tone: z.string().max(200).optional(),
    keywords: z.array(z.string().max(50)).max(30).optional(),
    copyStatus: copyStatusSchema.optional(),
  }),
});

export const setNodeMetaClientVisibilitySchema = z.object({
  taskId: z.string().uuid(),
  visible: z.boolean(),
});
```

## Estimate input parser

Dodaj helper `parseEstimateInput(input: string): number | null` u isti fajl ili `lib/architecture/estimate-rollup.ts`:

```ts
// Parses "2h 30m", "90m", "1.5h", "2h", "30" (treated as minutes) → minutes integer
// Returns null if unparseable
export function parseEstimateInput(input: string): number | null {
  const s = input.trim().toLowerCase();
  
  // "2h 30m" or "2h30m"
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)\s*m?$/);
  if (hm) return Math.round(parseFloat(hm[1]) * 60 + parseInt(hm[2]));
  
  // "2h" or "1.5h"
  const h = s.match(/^(\d+(?:\.\d+)?)\s*h$/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  
  // "90m" or "90"
  const m = s.match(/^(\d+)\s*m?$/);
  if (m) return parseInt(m[1]);
  
  return null;
}
```

## Definition of done

- [ ] `lib/validation/architecture.ts` extended with all schemas
- [ ] `parseEstimateInput` exists and handles all formats
- [ ] TypeScript builds without errors (`npx tsc --noEmit`)
- [ ] Existing tests still pass
