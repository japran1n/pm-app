"use client";

// F434-F440: workspace settings' "Task types" panel — flatter than
// StatusTemplateManager (a task type has no nested items, just name +
// colour), same reorder/add/rename/recolor/delete shape otherwise.
//
// `canManage` only controls whether the add/rename/reorder/remove
// controls render — every action in lib/actions/task-types.ts
// independently re-checks `requireWorkspaceAdmin` server-side.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createTaskType,
  deleteTaskType,
  reorderTaskType,
  updateTaskType,
} from "@/lib/actions/task-types";
import { calculatePosition } from "@/lib/board/position";
import { COLUMN_COLOR_PALETTE, DEFAULT_COLUMN_COLOR } from "@/lib/board/column-colors";
import type { TaskType } from "@/lib/queries/task-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// F005b (missions/20260903-portal): what each stable `system_key`
// (20260912010000_task_type_system_key.sql) means to a team member
// reading this settings screen. Only `page` is wired to anything today
// (`getPortalPages`) — the other four values the migration's check
// constraint allows are reserved for future features, so they fall back
// to a generic explanation rather than a dedicated one per key.
const SYSTEM_KEY_EXPLANATIONS: Record<string, string> = {
  page: "The portal's Pages view lists every task of this type. Renaming it here is safe — the portal follows this type by its role, not its name.",
};
const DEFAULT_SYSTEM_KEY_EXPLANATION =
  "The portal uses this type automatically. Renaming it here is safe — the portal follows this type by its role, not its name.";

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

function TaskTypeRow({
  taskType,
  isFirst,
  isLast,
  canManage,
  onMove,
  onRemoved,
}: {
  taskType: TaskType;
  isFirst: boolean;
  isLast: boolean;
  canManage: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemoved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(taskType.name);

  function saveName() {
    if (!name.trim() || name === taskType.name) {
      setName(taskType.name);
      return;
    }
    startTransition(async () => {
      const result = await updateTaskType({ taskTypeId: taskType.id, name });
      if (!result.ok) {
        setName(taskType.name);
        toast.error(result.error);
        return;
      }
      onRemoved(); // reuse as "changed" signal — see manager's onChanged doc
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5">
      <ColorSwatch color={taskType.color} />

      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        disabled={!canManage || isPending}
        className="h-8 w-40"
        aria-label="Task type name"
      />

      {taskType.systemKey && (
        <Tooltip>
          <TooltipTrigger
            type="button"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Badge variant="outline">Portal</Badge>
          </TooltipTrigger>
          <TooltipContent>
            {SYSTEM_KEY_EXPLANATIONS[taskType.systemKey] ?? DEFAULT_SYSTEM_KEY_EXPLANATION}
          </TooltipContent>
        </Tooltip>
      )}

      <Select
        value={taskType.color}
        onValueChange={(value) => {
          if (!value) return;
          startTransition(async () => {
            const result = await updateTaskType({ taskTypeId: taskType.id, color: value });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            onRemoved();
          });
        }}
        disabled={!canManage || isPending}
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Task type colour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLUMN_COLOR_PALETTE.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <ColorSwatch color={option.value} /> {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {canManage && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isFirst || isPending}
            onClick={() => onMove("up")}
            aria-label="Move up"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isLast || isPending}
            onClick={() => onMove("down")}
            aria-label="Move down"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await deleteTaskType({ taskTypeId: taskType.id });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                onRemoved();
              });
            }}
            aria-label={`Delete ${taskType.name}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function TaskTypeManager({
  workspaceId,
  initialTaskTypes,
  canManage,
}: {
  workspaceId: string;
  initialTaskTypes: TaskType[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  // F428's own render-time-sync convention (react-hooks/set-state-in-effect
  // safe): local list re-syncs from fresh props the instant router.refresh()
  // delivers them, no extra render pass in between.
  const [taskTypes, setTaskTypes] = useState(initialTaskTypes);
  const [syncedInitial, setSyncedInitial] = useState(initialTaskTypes);
  if (initialTaskTypes !== syncedInitial) {
    setSyncedInitial(initialTaskTypes);
    setTaskTypes(initialTaskTypes);
  }

  function refresh() {
    router.refresh();
  }

  function move(taskTypeId: string, direction: "up" | "down") {
    const sorted = [...taskTypes].sort((a, b) => a.position - b.position);
    const index = sorted.findIndex((item) => item.id === taskTypeId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const before = direction === "up" ? sorted[swapWith - 1] : sorted[index];
    const after = direction === "up" ? sorted[swapWith] : sorted[swapWith + 1];
    const newPosition = calculatePosition(
      before?.position ?? null,
      after?.position ?? null,
    );

    startTransition(async () => {
      const result = await reorderTaskType({ taskTypeId, newPosition });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {taskTypes
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((taskType, index) => (
            <TaskTypeRow
              key={taskType.id}
              taskType={taskType}
              isFirst={index === 0}
              isLast={index === taskTypes.length - 1}
              canManage={canManage}
              onMove={(direction) => move(taskType.id, direction)}
              onRemoved={refresh}
            />
          ))}
      </div>

      {taskTypes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No task types yet.
          {canManage &&
            " Create one below — e.g. Setup, Design, Dev, SEO, QA — to tag and filter tasks by it."}
        </p>
      )}

      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Dev"
            className="h-8 max-w-xs"
            aria-label="New task type name"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || !newName.trim()}
            onClick={() => {
              const name = newName.trim();
              startTransition(async () => {
                const result = await createTaskType({
                  workspaceId,
                  name,
                  color: DEFAULT_COLUMN_COLOR,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setNewName("");
                refresh();
              });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New task type
          </Button>
        </div>
      )}
    </div>
  );
}
