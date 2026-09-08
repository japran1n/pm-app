"use client";

// F112 (missions/20260903-portal, six-star review Part 0/D): the
// project-settings "Team" editor, beside "Who approves what"
// (components/approvals/decision-owners.tsx) — same Select-bound-to-a-
// Server-Action, toast-on-result pattern that component already
// established, reused here rather than a second one, per this feature's
// own instruction to match how that works.

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  removeProjectRole,
  setProjectRole,
} from "@/lib/actions/project-roles";
import {
  PROJECT_ROLE_ORDER,
  PROJECT_ROLE_LABELS,
  type ProjectRoleRow,
  type ProjectRoleValue,
  type ProjectTeamCandidate,
} from "@/lib/project-roles-shared";
import { UserAvatar } from "@/components/user-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function AssignedRoleRow({
  projectId,
  row,
  disabled,
}: {
  projectId: string;
  row: ProjectRoleRow;
  disabled: boolean;
}) {
  const [note, setNote] = useState(row.note ?? "");
  const [isPending, startTransition] = useTransition();

  function handleNoteBlur() {
    if (note.trim() === (row.note ?? "")) return;
    startTransition(async () => {
      const result = await setProjectRole(projectId, row.userId, row.role, note.trim() || null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Role updated.");
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeProjectRole(projectId, row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${PROJECT_ROLE_LABELS[row.role]} removed.`);
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <UserAvatar person={{ id: row.userId, name: row.name, avatarUrl: row.avatarUrl }} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-mini font-medium">{row.name ?? row.email ?? row.userId}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
            {PROJECT_ROLE_LABELS[row.role]}
          </span>
        </div>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={handleNoteBlur}
          disabled={disabled || isPending}
          placeholder="What they own on this project (one line)"
          maxLength={280}
          className="h-8 text-micro"
        />
      </div>
      {isPending && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={isPending}
          onClick={handleRemove}
          aria-label={`Remove ${PROJECT_ROLE_LABELS[row.role]} role`}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

const NONE_VALUE = "__none__";

function AddRoleForm({
  projectId,
  candidates,
  taken,
}: {
  projectId: string;
  candidates: ProjectTeamCandidate[];
  taken: Set<string>;
}) {
  const [userId, setUserId] = useState(NONE_VALUE);
  const [role, setRole] = useState<ProjectRoleValue>(PROJECT_ROLE_ORDER[0]);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    if (userId === NONE_VALUE) {
      toast.error("Choose a person first.");
      return;
    }
    if (taken.has(`${userId}:${role}`)) {
      toast.error("That person already has this role.");
      return;
    }
    startTransition(async () => {
      const result = await setProjectRole(projectId, userId, role, note.trim() || null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNote("");
      toast.success(`${PROJECT_ROLE_LABELS[role]} assigned.`);
    });
  }

  if (candidates.length === 0) {
    return (
      <p className="text-mini text-muted-foreground">
        This project has no team members yet. Add one above, then come back
        here to say what they do.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
      <Select value={userId} onValueChange={(v) => typeof v === "string" && setUserId(v)}>
        <SelectTrigger className="w-48" aria-label="Person">
          <SelectValue placeholder="Choose a person" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.userId} value={c.userId}>
              {c.name ?? c.email ?? c.userId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={role} onValueChange={(v) => typeof v === "string" && setRole(v as ProjectRoleValue)}>
        <SelectTrigger className="w-40" aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECT_ROLE_ORDER.map((value) => (
            <SelectItem key={value} value={value}>
              {PROJECT_ROLE_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What they own (optional)"
        maxLength={280}
        className="h-9 w-56 text-mini"
      />
      <Button type="button" size="sm" onClick={handleAdd} disabled={isPending}>
        {isPending && <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />}
        Add role
      </Button>
    </div>
  );
}

export function ProjectRolesSection({
  projectId,
  roles,
  candidates,
  canManage,
}: {
  projectId: string;
  roles: ProjectRoleRow[];
  candidates: ProjectTeamCandidate[];
  canManage: boolean;
}) {
  const orderIndex = new Map(PROJECT_ROLE_ORDER.map((value, index) => [value, index]));
  const sorted = [...roles].sort(
    (a, b) => (orderIndex.get(a.role) ?? 99) - (orderIndex.get(b.role) ?? 99),
  );
  const taken = new Set(roles.map((r) => `${r.userId}:${r.role}`));

  return (
    <div className="flex flex-col gap-2">
      {sorted.length === 0 ? (
        <p className="text-mini text-muted-foreground">No roles assigned yet.</p>
      ) : (
        sorted.map((row) => (
          <AssignedRoleRow key={row.id} projectId={projectId} row={row} disabled={!canManage} />
        ))
      )}
      {canManage && <AddRoleForm projectId={projectId} candidates={candidates} taken={taken} />}
    </div>
  );
}
