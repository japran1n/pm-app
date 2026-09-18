# F13 — Server actions: `lib/actions/architecture/node-meta.ts`

**Status:** [CLARIFIED]
**Estimate:** 30 min
**Depends on:** F07 (schemas)

## Task

Napravi `lib/actions/architecture/node-meta.ts`.

## Funkcije

### `setNodeMeta(taskId, patch)`

Isti lanac kao estimates.ts, pa upsert na `architecture_node_meta`:

```ts
// Normalize keywords server-side
const normalizedKeywords = patch.keywords
  ? [...new Set(patch.keywords.map(k => k.trim().toLowerCase()).filter(Boolean))].slice(0, 30)
  : undefined;

await admin.from('architecture_node_meta').upsert({
  task_id: taskId,
  project_id: projectId,
  ...(patch.intent !== undefined && { intent: patch.intent || null }),
  ...(patch.audience !== undefined && { audience: patch.audience || null }),
  ...(patch.primaryCta !== undefined && { primary_cta: patch.primaryCta || null }),
  ...(patch.tone !== undefined && { tone: patch.tone || null }),
  ...(normalizedKeywords !== undefined && { keywords: normalizedKeywords }),
  ...(patch.copyStatus !== undefined && { copy_status: patch.copyStatus }),
  updated_by: user.id,
}, { onConflict: 'task_id' });
```

`revalidatePath('/w', 'layout')` — **bez** revalidatePortalProject.

### `setNodeMetaClientVisibility(taskId, visible)`

Isti lanac, pa:
```ts
await admin.from('architecture_node_meta').upsert({
  task_id: taskId,
  project_id: projectId,
  client_visible: visible,
  updated_by: user.id,
}, { onConflict: 'task_id' });
```

Ova akcija **poziva** `revalidatePortalProject` jer utiče na portal vidljivost.

## Re-export u barrel

```ts
export { setNodeMeta, setNodeMetaClientVisibility } from './architecture/node-meta';
```

## Definition of done

- [ ] `lib/actions/architecture/node-meta.ts` postoji sa `'use server'`
- [ ] Keywords normalizacija: trim, lowercase, dedup, filter empty, max 30
- [ ] `setNodeMetaClientVisibility` poziva `revalidatePortalProject`
- [ ] `setNodeMeta` NE poziva `revalidatePortalProject`
- [ ] Re-export iz barrel-a
- [ ] TypeScript build prolazi
