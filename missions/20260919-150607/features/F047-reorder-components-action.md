# F047 — `reorderComponents` akcija + validacija potpune liste

_Mission: 20260919-150607_ _Milestone: M8_

## Svrha

Dodati server akciju `reorderComponents` koja prima novu listu redosljeda
komponenti i validira da je potpuna (sve postojeće komponente su uključene).

## Šta se gradi

### 1. Schema u `lib/validation/architecture.ts`

```typescript
export const reorderComponentsSchema = z.object({
  projectId: z.string().uuid(),
  componentIds: z.array(z.string().uuid()).min(1),
});
export type ReorderComponentsInput = z.infer<typeof reorderComponentsSchema>;
```

### 2. Akcija u `lib/actions/architecture/components.ts`

```typescript
export async function reorderComponents(
  projectId: string,
  componentIds: string[],
): Promise<MutationResult>
```

Logika:
1. Validate schema
2. getCurrentUser() — error ako nije prijavljen
3. Admin client — provjeri workspace membership + canWrite
4. Fetch existing component IDs for project (non-deleted)
5. **Validacija potpune liste**: `new Set(componentIds)` mora sadržavati
   iste ID-ove kao što su pronađeni u bazi. Ako fali neki ID ili ima extra —
   return error "Component list is incomplete."
6. Batch update: za svaki componentId[i], update `position = i`
7. revalidatePath("/w", "layout")

### 3. Export u `lib/actions/architecture.ts` barrel

Add `reorderComponents` to the components export block.

### 4. Update barrel guard

Bump `EXPECTED_ACTION_COUNT` from 24 to 25.

## Tvrdnje

- **AS-159**: `reorderComponents` aksija postoji i exportovana je iz barrela
- **AS-160**: akcija odbija poziv koji ne uključuje sve komponente projekta
- **AS-161**: akcija upisuje nove position vrijednosti za sve komponente

## Clarified implementation

- Pattern: same as reorderPages (already exists in pages.ts)
- Validation: exact set match between componentIds and DB component IDs
- Position: componentIds index → position value
- No dnd-kit here — that's F048

## Definition of done

- Action exists in barrel
- Tests: AS-159 (export), AS-160 (incomplete list rejected), AS-161 (positions written)
- tsc + lint + barrel guard green
