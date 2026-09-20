# F048 — Prevlačenje u panelu komponenti preko `dnd-kit`

_Mission: 20260919-150607_ _Milestone: M8_

## Zavisnost

**Zavisi od F047** (akcija mora biti gotova). Ne pokretati paralelno.

## Svrha

Dodati drag-and-drop reordering u `ComponentPanel` koristeći `@dnd-kit` (već
dostupan u projektu — koristi se u kalendaru).

## Šta se gradi

U `components/architecture/component-panel.tsx`:

1. Dodati `DndContext` + `SortableContext` oko liste komponenti
   (isti pattern kao `sortable-section-list.tsx` ili kalendar)

2. Svaki `ComponentListItem` postaje draggable:
   ```tsx
   const { attributes, listeners, setNodeRef, transform, transition } =
     useSortable({ id: component.id });
   ```

3. `onDragEnd` handler poziva `reorderComponents(projectId, newOrder)`
   i `router.refresh()`

4. Drag handle (grip icon) na svakom ComponentListItem

## Tvrdnje

- **AS-162**: component panel ima DndContext sa SortableContext
- **AS-163**: drag-and-drop mijenja redosljed komponenti (onDragEnd poziva reorderComponents)
- **AS-164**: uspješan reorder osvježava prikaz (router.refresh())

## Ograničenja

- Koristiti `@dnd-kit/sortable` i `@dnd-kit/core` (već u package.json)
- `useSortable` pattern kao u `sortable-section-list.tsx`
- Drag grip — ikona `GripVertical` iz lucide-react

## Clarified implementation

- Check sortable-section-list.tsx for the exact DnD pattern used in this codebase
- Use same DndContext/SortableContext pattern
- onDragEnd: arrayMove + reorderComponents call
- No optimistic UI needed — router.refresh() after save

## Definition of done

- DndContext wraps component list
- Drag-and-drop works (dragging changes order)
- onDragEnd calls reorderComponents and router.refresh()
- tsc + lint clean
- Unit test for onDragEnd behavior
