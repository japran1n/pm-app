"use client";

// F219: the project settings "Board columns" panel's interactive surface
// (AS-404, AS-405, AS-414). The settings page
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/
// page.tsx, a Server Component) fetches and renders the list; this file is
// the only Client Component, same "smallest possible client boundary"
// convention as components/project/project-members.tsx.
//
// AS-414: `canManage` only controls whether the add/rename/reorder/remove
// controls render — it is a UI convenience, not the security boundary.
// Every action in lib/actions/statuses.ts independently re-checks
// `canManageColumns` server-side and rejects the call regardless of what
// this component renders.
//
// Reorder uses simple move-up/move-down controls (rather than a
// drag-and-drop library) computing the new fractional-index value via the
// same lib/board/position.ts `calculatePosition` the board's card
// drag-and-drop already uses — the simpler option that adds no new
// dependency, per this feature's Clarified implementation's ambiguity
// resolution.

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addColumn, removeColumn, reorderColumn, updateColumn } from "@/lib/actions/statuses";
import { calculatePosition } from "@/lib/board/position";
import { COLUMN_CATEGORIES, COLUMN_COLOR_PALETTE, DEFAULT_COLUMN_COLOR } from "@/lib/board/column-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type ProjectColumn = {
  id: string;
  name: string;
  color: string;
  category: "not_started" | "in_progress" | "done";
  position: number;
};

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

function ColumnRow({
  column,
  isFirst,
  isLast,
  onChanged,
  onRemoved,
  onMove,
}: {
  column: ProjectColumn;
  isFirst: boolean;
  isLast: boolean;
  onChanged: (column: ProjectColumn) => void;
  onRemoved: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [category, setCategory] = useState(column.category);
  const [isPending, startTransition] = useTransition();

  function submitUpdate(nextName: string, nextColor: string, nextCategory: typeof category) {
    const previous = { name, color, category };
    setName(nextName);
    setColor(nextColor);
    setCategory(nextCategory);

    startTransition(async () => {
      const result = await updateColumn({
        columnId: column.id,
        name: nextName,
        color: nextColor,
        category: nextCategory,
      });

      if (!result.ok) {
        setName(previous.name);
        setColor(previous.color);
        setCategory(previous.category);
        toast.error(result.error);
        return;
      }

      onChanged({
        id: result.data.id,
        name: result.data.name,
        color: result.data.color,
        category: result.data.category as ProjectColumn["category"],
        position: result.data.position,
      });
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeColumn(column.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(column.id);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <ColorSwatch color={color} />

      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name !== column.name) {
            submitUpdate(name, color, category);
          } else {
            setName(column.name);
          }
        }}
        disabled={isPending}
        className="w-40"
        aria-label="Column name"
      />

      <Select
        value={color}
        onValueChange={(value) => value && submitUpdate(name, value, category)}
        disabled={isPending}
      >
        <SelectTrigger className="w-32" aria-label="Column colour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLUMN_COLOR_PALETTE.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                <ColorSwatch color={option.value} />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={category}
        onValueChange={(value) =>
          value && submitUpdate(name, color, value as ProjectColumn["category"])
        }
        disabled={isPending}
      >
        <SelectTrigger className="w-36" aria-label="Column category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLUMN_CATEGORIES.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isFirst || isPending}
          aria-label={`Move ${column.name} up`}
          onClick={() => onMove(column.id, "up")}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isLast || isPending}
          aria-label={`Move ${column.name} down`}
          onClick={() => onMove(column.id, "down")}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isPending}
                aria-label={`Remove ${column.name}`}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove &ldquo;{column.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This column must have no tasks in it. Move any tasks to another
                column first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemove}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function StatusManager({
  projectId,
  initialColumns,
  canManage,
}: {
  projectId: string;
  initialColumns: ProjectColumn[];
  canManage: boolean;
}) {
  const [columns, setColumns] = useState<ProjectColumn[]>(
    [...initialColumns].sort((a, b) => a.position - b.position),
  );
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLUMN_COLOR);
  const [newCategory, setNewCategory] = useState<ProjectColumn["category"]>("not_started");
  const [isAdding, startAddTransition] = useTransition();
  const [, startReorderTransition] = useTransition();

  function replaceColumn(next: ProjectColumn) {
    setColumns((current) =>
      current
        .map((c) => (c.id === next.id ? next : c))
        .sort((a, b) => a.position - b.position),
    );
  }

  function removeFromList(id: string) {
    setColumns((current) => current.filter((c) => c.id !== id));
  }

  function handleAdd() {
    if (!newName.trim()) {
      toast.error("Column name is required.");
      return;
    }

    startAddTransition(async () => {
      const result = await addColumn({
        projectId,
        name: newName,
        color: newColor,
        category: newCategory,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setColumns((current) =>
        [
          ...current,
          {
            id: result.data.id,
            name: result.data.name,
            color: result.data.color,
            category: result.data.category as ProjectColumn["category"],
            position: result.data.position,
          },
        ].sort((a, b) => a.position - b.position),
      );
      setNewName("");
      setNewColor(DEFAULT_COLUMN_COLOR);
      setNewCategory("not_started");
    });
  }

  function handleMove(id: string, direction: "up" | "down") {
    const index = columns.findIndex((c) => c.id === id);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;

    const ordered = [...columns];

    let prevPosition: number | null;
    let nextPosition: number | null;

    if (direction === "up") {
      prevPosition = targetIndex - 1 >= 0 ? ordered[targetIndex - 1].position : null;
      nextPosition = ordered[targetIndex].position;
    } else {
      prevPosition = ordered[targetIndex].position;
      nextPosition =
        targetIndex + 1 < ordered.length ? ordered[targetIndex + 1].position : null;
    }

    const newPosition = calculatePosition(prevPosition, nextPosition);
    const previousPosition = ordered[index].position;

    setColumns((current) =>
      current
        .map((c) => (c.id === id ? { ...c, position: newPosition } : c))
        .sort((a, b) => a.position - b.position),
    );

    startReorderTransition(async () => {
      const result = await reorderColumn(id, newPosition);
      if (!result.ok) {
        setColumns((current) =>
          current
            .map((c) => (c.id === id ? { ...c, position: previousPosition } : c))
            .sort((a, b) => a.position - b.position),
        );
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="status-manager-list">
        {columns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No board columns yet.</p>
        ) : (
          columns.map((column, index) =>
            canManage ? (
              <ColumnRow
                key={column.id}
                column={column}
                isFirst={index === 0}
                isLast={index === columns.length - 1}
                onChanged={replaceColumn}
                onRemoved={removeFromList}
                onMove={handleMove}
              />
            ) : (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-md border border-border p-3"
              >
                <ColorSwatch color={column.color} />
                <span className="text-sm">{column.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {COLUMN_CATEGORIES.find((c) => c.value === column.category)?.label}
                </span>
              </div>
            ),
          )
        )}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Input
            placeholder="New column name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={isAdding}
            className="w-40"
          />
          <Select
            value={newColor}
            onValueChange={(value) => value && setNewColor(value)}
            disabled={isAdding}
          >
            <SelectTrigger className="w-32" aria-label="New column colour">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_COLOR_PALETTE.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <ColorSwatch color={option.value} />
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={newCategory}
            onValueChange={(value) =>
              value && setNewCategory(value as ProjectColumn["category"])
            }
            disabled={isAdding}
          >
            <SelectTrigger className="w-36" aria-label="New column category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_CATEGORIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add column"}
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            type="button"
            disabled
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground opacity-50"
          >
            Add column
          </TooltipTrigger>
          <TooltipContent>Only a project admin or lead can manage columns.</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
