"use client";

// Project settings "Custom fields" panel's interactive surface. Mirrors
// components/project/status-manager.tsx: a Server Component page fetches
// and renders the list, this file is the only Client Component.
//
// `canManage` only controls whether the add/remove controls render — it
// is a UI convenience, not the security boundary. Every action in
// lib/actions/custom-fields.ts independently re-checks `canManageColumns`
// server-side and rejects the call regardless of what this component
// renders.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { createCustomField, deleteCustomField } from "@/lib/actions/custom-fields";
import type { CustomFieldType } from "@/lib/validation/custom-fields";
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

export type ProjectCustomFieldRow = {
  id: string;
  name: string;
  fieldType: CustomFieldType;
  position: number;
};

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "url", label: "URL" },
  { value: "checkbox", label: "Checkbox" },
];

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  url: "URL",
  checkbox: "Checkbox",
};

function FieldRow({
  field,
  onRemoved,
}: {
  field: ProjectCustomFieldRow;
  onRemoved: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const result = await deleteCustomField(field.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(field.id);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <span className="font-medium">{field.name}</span>
      <span className="text-micro text-muted-foreground">
        {FIELD_TYPE_LABELS[field.fieldType]}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isPending}
                aria-label={`Remove ${field.name}`}
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
              <AlertDialogTitle>Remove &ldquo;{field.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                Every task&apos;s saved value for this field will be removed too. This
                can&apos;t be undone.
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

export function CustomFieldsManager({
  projectId,
  initialFields,
  canManage,
}: {
  projectId: string;
  initialFields: ProjectCustomFieldRow[];
  canManage: boolean;
}) {
  const [fields, setFields] = useState<ProjectCustomFieldRow[]>(
    [...initialFields].sort((a, b) => a.position - b.position),
  );
  const [newName, setNewName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [isAdding, startAddTransition] = useTransition();

  function removeFromList(id: string) {
    setFields((current) => current.filter((f) => f.id !== id));
  }

  function handleAdd() {
    if (!newName.trim()) {
      toast.error("Field name is required.");
      return;
    }

    startAddTransition(async () => {
      const result = await createCustomField({
        projectId,
        name: newName,
        fieldType: newFieldType,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setFields((current) =>
        [
          ...current,
          {
            id: result.data.id,
            name: result.data.name,
            fieldType: result.data.fieldType,
            position: result.data.position,
          },
        ].sort((a, b) => a.position - b.position),
      );
      setNewName("");
      setNewFieldType("text");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="custom-fields-manager-list">
        {fields.length === 0 ? (
          <p className="text-mini text-muted-foreground">No custom fields yet.</p>
        ) : (
          fields.map((field) =>
            canManage ? (
              <FieldRow key={field.id} field={field} onRemoved={removeFromList} />
            ) : (
              <div
                key={field.id}
                className="flex items-center gap-2 rounded-md border border-border p-3"
              >
                <span className="text-mini">{field.name}</span>
                <span className="ml-auto text-micro text-muted-foreground">
                  {FIELD_TYPE_LABELS[field.fieldType]}
                </span>
              </div>
            ),
          )
        )}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Input
            placeholder="New field name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={isAdding}
            className="w-48"
          />
          <Select
            value={newFieldType}
            onValueChange={(value) => value && setNewFieldType(value as CustomFieldType)}
            disabled={isAdding}
          >
            <SelectTrigger className="w-36" aria-label="New field type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add field"}
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            type="button"
            disabled
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-mini font-medium text-primary-foreground opacity-50"
          >
            Add field
          </TooltipTrigger>
          <TooltipContent>Only a project admin or lead can manage custom fields.</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
