"use client";

// Mission 20260910-182104, F026 (AS-053, AS-067, AS-068): a combobox for
// linking a section to one of the project's existing components, or
// creating a new one from the typed name. Uses the app's existing
// Command primitive (components/ui/command.tsx, cmdk-backed) inside a
// Popover, the same "search + select or create" pattern already used
// elsewhere in the app (e.g. components/command/project-switcher.tsx).
//
// AS-067: the list is the `components` prop passed down from the board
// (lib/queries/architecture.ts's `BoardComponent[]`) -- filtered
// client-side by the typed search text, no extra fetch.
//
// AS-068: when the typed name doesn't exactly match (case-insensitively)
// any existing component, a "Create '<name>'" row is offered at the
// bottom of the list. Selecting it calls `createComponent` then
// `linkComponentToSection` in sequence.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createComponent,
  linkComponentToSection,
} from "@/lib/actions/architecture";
import type { BoardComponent } from "@/lib/queries/architecture";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function ComponentPicker({
  projectId,
  sectionId,
  currentComponentId,
  components,
  onClose,
}: {
  projectId: string;
  sectionId: string;
  currentComponentId: string | null;
  components: BoardComponent[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const trimmedSearch = search.trim();

  const filteredComponents = useMemo(() => {
    if (!trimmedSearch) return components;
    const needle = trimmedSearch.toLowerCase();
    return components.filter((component) =>
      component.name.toLowerCase().includes(needle),
    );
  }, [components, trimmedSearch]);

  const hasExactMatch = components.some(
    (component) =>
      component.name.toLowerCase() === trimmedSearch.toLowerCase(),
  );

  function linkExisting(componentId: string) {
    startTransition(async () => {
      const result = await linkComponentToSection(sectionId, componentId);

      if (result.success) {
        router.refresh();
        onClose();
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function createAndLink() {
    if (!trimmedSearch) return;

    startTransition(async () => {
      const createResult = await createComponent(projectId, trimmedSearch);

      if (!createResult.success || !createResult.id) {
        toast.error(
          createResult.error ?? "Something went wrong. Please try again.",
        );
        return;
      }

      const linkResult = await linkComponentToSection(
        sectionId,
        createResult.id,
      );

      if (linkResult.success) {
        router.refresh();
        onClose();
      } else {
        toast.error(
          linkResult.error ?? "Something went wrong. Please try again.",
        );
      }
    });
  }

  return (
    <Command shouldFilter={false} className="w-64">
      <CommandInput
        autoFocus
        placeholder="Search or create a component..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {filteredComponents.length === 0 && !trimmedSearch ? (
          <CommandEmpty>No components yet.</CommandEmpty>
        ) : null}
        {filteredComponents.length > 0 ? (
          <CommandGroup heading="Components">
            {filteredComponents.map((component) => (
              <CommandItem
                key={component.id}
                value={component.id}
                disabled={isPending}
                data-checked={component.id === currentComponentId}
                onSelect={() => linkExisting(component.id)}
              >
                {component.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {trimmedSearch && !hasExactMatch ? (
          <CommandGroup heading={filteredComponents.length > 0 ? undefined : "Create"}>
            <CommandItem
              value={`create-${trimmedSearch}`}
              disabled={isPending}
              onSelect={createAndLink}
            >
              <Plus className="size-4" aria-hidden="true" />
              Create &quot;{trimmedSearch}&quot;
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
}
