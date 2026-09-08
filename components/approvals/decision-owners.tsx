"use client";

// F008 section 4: project settings' "Who approves what" section.
// Decision types are now CUSTOMIZABLE per project (project_decision_types)
// rather than four fixed rows — this renders whatever `decisionTypes` the
// Server Component page passed in, plus add/remove controls. Each row
// still reuses components/project/project-members.tsx's picker pattern (a
// Select bound to a Server Action, toast on result), same as before.

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  setDecisionOwner,
  addProjectDecisionType,
  removeProjectDecisionType,
} from "@/lib/actions/approvals";
import type {
  ApprovalDecisionType,
  PortalDecisionOwner,
  ProjectClientMember,
  ProjectDecisionType,
} from "@/lib/queries/approvals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE_VALUE = "__none__";

function DecisionOwnerRow({
  projectId,
  decisionType,
  label,
  description,
  ownerId,
  clientMembers,
  disabled,
  onRemove,
  canRemove,
}: {
  projectId: string;
  decisionType: ApprovalDecisionType;
  label: string;
  description: string | null;
  ownerId: string | null;
  clientMembers: ProjectClientMember[];
  disabled: boolean;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [value, setValue] = useState(ownerId ?? NONE_VALUE);
  const [isPending, startTransition] = useTransition();
  const [isRemoving, startRemoveTransition] = useTransition();
  const selectedMember = clientMembers.find((member) => member.userId === value);

  function handleChange(nextValue: string) {
    const previous = value;
    setValue(nextValue);
    startTransition(async () => {
      const result = await setDecisionOwner(
        projectId,
        decisionType,
        nextValue === NONE_VALUE ? null : nextValue,
      );
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`${label} decisions: owner updated.`);
    });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      const result = await removeProjectDecisionType(projectId, decisionType);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} decision type removed.`);
      onRemove();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <div className="flex items-center gap-2">
        {(isPending || isRemoving) && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        <Select
          value={value}
          onValueChange={(nextValue) => {
            if (typeof nextValue === "string") handleChange(nextValue);
          }}
          disabled={disabled || isPending}
        >
          <SelectTrigger id={`decision-owner-${decisionType}`} className="w-56">
            <SelectValue placeholder="No owner set">
              {value === NONE_VALUE
                ? "No owner"
                : (selectedMember?.name ?? selectedMember?.email ?? selectedMember?.userId ?? "No owner")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>No owner</SelectItem>
            {clientMembers.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name ?? member.email ?? member.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || isRemoving}
            onClick={handleRemove}
            aria-label={`Remove ${label} decision type`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddDecisionTypeForm({
  projectId,
  disabled,
  onAdded,
}: {
  projectId: string;
  disabled: boolean;
  onAdded: (decisionType: ProjectDecisionType) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await addProjectDecisionType(projectId, name.trim(), description.trim() || null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.name} decision type added.`);
      setName("");
      setDescription("");
      onAdded(result.data);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-1 min-w-[10rem] flex-col gap-1">
        <label htmlFor="new-decision-type-name" className="text-xs font-medium text-muted-foreground">
          New decision type
        </label>
        <Input
          id="new-decision-type-name"
          value={name}
          onChange={(changeEvent) => setName(changeEvent.target.value)}
          placeholder="e.g. Legal"
          maxLength={100}
          disabled={disabled || isPending}
        />
      </div>
      <div className="flex flex-1 min-w-[12rem] flex-col gap-1">
        <label htmlFor="new-decision-type-description" className="text-xs font-medium text-muted-foreground">
          Description (optional)
        </label>
        <Input
          id="new-decision-type-description"
          value={description}
          onChange={(changeEvent) => setDescription(changeEvent.target.value)}
          placeholder="What this decision type covers"
          maxLength={500}
          disabled={disabled || isPending}
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={disabled || isPending || !name.trim()}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        Add
      </Button>
    </form>
  );
}

export function DecisionOwnersSection({
  projectId,
  owners,
  decisionTypes,
  clientMembers,
  canManage,
}: {
  projectId: string;
  owners: PortalDecisionOwner[];
  decisionTypes: ProjectDecisionType[];
  clientMembers: ProjectClientMember[];
  canManage: boolean;
}) {
  const [types, setTypes] = useState(decisionTypes);
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner.userId]));

  if (clientMembers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This project has no client members yet. Add one from the workspace
        members page, then come back here to say who decides what.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {types.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This project has no decision types yet. Add one below to start
          assigning owners.
        </p>
      )}
      {types.map((type) => (
        <DecisionOwnerRow
          key={type.id}
          projectId={projectId}
          decisionType={type.name}
          label={type.name}
          description={type.description}
          ownerId={ownerByType.get(type.name) ?? null}
          clientMembers={clientMembers}
          disabled={!canManage}
          canRemove={canManage}
          onRemove={() => setTypes((current) => current.filter((t) => t.id !== type.id))}
        />
      ))}
      {canManage && (
        <AddDecisionTypeForm
          projectId={projectId}
          disabled={!canManage}
          onAdded={(newType) => setTypes((current) => [...current, newType])}
        />
      )}
    </div>
  );
}
