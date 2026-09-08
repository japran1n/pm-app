"use client";

// F428-F430: workspace settings' "Status templates" panel. A template's
// items carry no tasks (they are copied into a project only at apply
// time — see 20260903010000_status_templates.sql's header comment), so
// this is simpler than components/project/status-manager.tsx's column
// editor: no reassignment dialog is needed to remove an item, since
// nothing depends on it yet.
//
// `canManage` only controls whether the add/rename/reorder/remove
// controls render — every action in lib/actions/status-templates.ts
// independently re-checks `requireWorkspaceAdmin` server-side (AS-573).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addTemplateItem,
  createStatusTemplate,
  deleteStatusTemplate,
  removeTemplateItem,
  renameStatusTemplate,
  reorderTemplateItem,
  updateTemplateItem,
} from "@/lib/actions/status-templates";
import { calculatePosition } from "@/lib/board/position";
import {
  COLUMN_CATEGORIES,
  COLUMN_COLOR_PALETTE,
  DEFAULT_COLUMN_COLOR,
} from "@/lib/board/column-colors";
import type { StatusTemplateWithItems } from "@/lib/queries/status-templates";
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

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

function TemplateItemRow({
  item,
  isFirst,
  isLast,
  canManage,
  onMove,
  onRemoved,
}: {
  item: StatusTemplateWithItems["items"][number];
  isFirst: boolean;
  isLast: boolean;
  canManage: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemoved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(item.name);

  function saveName() {
    if (!name.trim() || name === item.name) {
      setName(item.name);
      return;
    }
    startTransition(async () => {
      const result = await updateTemplateItem({ itemId: item.id, name });
      if (!result.ok) {
        setName(item.name);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5">
      <ColorSwatch color={item.color} />

      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        disabled={!canManage || isPending}
        className="h-8 w-40"
        aria-label="Column name"
      />

      <Select
        value={item.color}
        onValueChange={(value) => {
          if (!value) return;
          startTransition(async () => {
            const result = await updateTemplateItem({ itemId: item.id, color: value });
            if (!result.ok) toast.error(result.error);
          });
        }}
        disabled={!canManage || isPending}
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Column colour">
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

      <Select
        value={item.category}
        onValueChange={(value) => {
          if (!value) return;
          startTransition(async () => {
            const result = await updateTemplateItem({
              itemId: item.id,
              category: value,
            });
            if (!result.ok) toast.error(result.error);
          });
        }}
        disabled={!canManage || isPending}
      >
        <SelectTrigger size="sm" className="w-32" aria-label="Column category">
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
                const result = await removeTemplateItem({ itemId: item.id });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                onRemoved();
              });
            }}
            aria-label="Remove column"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  canManage,
  onChanged,
}: {
  template: StatusTemplateWithItems;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(template.name);

  function move(itemId: string, direction: "up" | "down") {
    const sorted = [...template.items].sort((a, b) => a.position - b.position);
    const index = sorted.findIndex((item) => item.id === itemId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const before = direction === "up" ? sorted[swapWith - 1] : sorted[index];
    const after = direction === "up" ? sorted[swapWith] : sorted[swapWith + 1];
    const newPosition = calculatePosition(
      before?.position ?? null,
      after?.position ?? null,
    );

    startTransition(async () => {
      const result = await reorderTemplateItem({ itemId, newPosition });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (!name.trim() || name === template.name) {
              setName(template.name);
              return;
            }
            startTransition(async () => {
              const result = await renameStatusTemplate({
                templateId: template.id,
                name,
              });
              if (!result.ok) {
                setName(template.name);
                toast.error(result.error);
                return;
              }
              onChanged();
            });
          }}
          disabled={!canManage || isPending}
          className="h-8 max-w-xs font-medium"
          aria-label="Template name"
        />

        {canManage && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete template">
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{template.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Projects that already applied this template keep their
                  columns — deleting the template only removes it from the
                  list of templates you can apply going forward.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startTransition(async () => {
                      const result = await deleteStatusTemplate({
                        templateId: template.id,
                      });
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      onChanged();
                    });
                  }}
                >
                  Delete template
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {template.items
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((item, index) => (
            <TemplateItemRow
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === template.items.length - 1}
              canManage={canManage}
              onMove={(direction) => move(item.id, direction)}
              onRemoved={onChanged}
            />
          ))}
      </div>

      {canManage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          className="w-fit"
          onClick={() => {
            startTransition(async () => {
              const result = await addTemplateItem({
                templateId: template.id,
                name: "New column",
                color: DEFAULT_COLUMN_COLOR,
                category: "not_started",
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              onChanged();
            });
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add column
        </Button>
      )}
    </div>
  );
}

export function StatusTemplateManager({
  workspaceId,
  initialTemplates,
  canManage,
}: {
  workspaceId: string;
  initialTemplates: StatusTemplateWithItems[];
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [newTemplateName, setNewTemplateName] = useState("");
  // F428: local state, refreshed via router.refresh() after every mutation
  // below — `revalidatePath` inside the Server Action only marks the route
  // segment stale, it does not re-render THIS already-mounted Client
  // Component's props on its own. `router.refresh()` is what actually
  // re-runs the parent Server Component and streams new props down, same
  // convention every other settings panel in this codebase relies on.
  // F428: adjusted DURING render on prop change, not via a synchronous
  // setState-in-effect (react-hooks/set-state-in-effect) — same convention
  // components/task/comment-list.tsx's `syncedMentionTaskId` pattern uses.
  // `router.refresh()` re-renders the Server Component parent with fresh
  // `initialTemplates`; this component's own edits (rename, add/remove
  // item, reorder) are reflected the instant that new prop value arrives,
  // with no extra effect/render pass in between.
  const [templates, setTemplates] = useState(initialTemplates);
  const [syncedTemplates, setSyncedTemplates] = useState(initialTemplates);
  if (initialTemplates !== syncedTemplates) {
    setSyncedTemplates(initialTemplates);
    setTemplates(initialTemplates);
  }
  const router = useRouter();

  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            canManage={canManage}
            onChanged={refresh}
          />
        ))}
      </div>

      {templates.length === 0 && (
        <p className="text-mini text-muted-foreground">
          No status templates yet.
          {canManage && " Create one below to reuse a set of columns across projects."}
        </p>
      )}

      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            value={newTemplateName}
            onChange={(event) => setNewTemplateName(event.target.value)}
            placeholder="e.g. Webflow project"
            className="h-8 max-w-xs"
            aria-label="New template name"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || !newTemplateName.trim()}
            onClick={() => {
              const name = newTemplateName.trim();
              startTransition(async () => {
                const result = await createStatusTemplate({ workspaceId, name });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setNewTemplateName("");
                refresh();
              });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New template
          </Button>
        </div>
      )}
    </div>
  );
}
