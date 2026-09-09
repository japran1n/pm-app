"use client";

// F133: the project settings panel's interactive pieces — member list row
// removal, the add-member picker, and the visibility toggle. The settings
// page (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/
// page.tsx, a Server Component) fetches and renders the static list;
// everything below is only the interactive surface, same "smallest
// possible client boundary" convention as RemoveMemberButton/
// MemberRoleSelect/InviteMemberForm (components/*.tsx) for the workspace
// members page.
//
// Visibility of the add/remove/visibility controls is a UI-only
// convenience gate driven by `canManageProjectMembers`/
// `canChangeProjectVisibility` (lib/auth/permissions.ts, AS-230's
// single-source-of-truth convention). The actual permission check lives
// server-side in addProjectMember/removeProjectMember/
// updateProjectVisibility themselves (lib/actions/project-members.ts) —
// hiding a control here is not the security boundary.

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  addProjectMember,
  removeProjectMember,
  updateProjectVisibility,
} from "@/lib/actions/project-members";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { UserAvatar } from "@/components/user-avatar";

export type ProjectMemberListItem = {
  id: string;
  userId: string;
  projectRole: "lead" | "member";
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  addedByName: string | null;
  createdAt: string;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// --- Member list row remove control ---------------------------------------

// Removing yourself from a project you can still administer as an admin
// (or lead) is allowed but warned about — not blocked — per the
// clarified spec's explicit resolution of this exact open question. Every
// other removal (someone else, or removing yourself when you would NOT
// retain admin/lead access afterwards) proceeds without the extra
// confirmation copy.
function RemoveMemberButton({
  projectId,
  userId,
  memberLabel,
  isSelf,
  callerRetainsAccess,
}: {
  projectId: string;
  userId: string;
  memberLabel: string;
  isSelf: boolean;
  callerRetainsAccess: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const result = await removeProjectMember(projectId, userId);
      if (result.ok) {
        toast.success(`${memberLabel} removed from this project.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const description =
    isSelf && callerRetainsAccess
      ? "You're removing yourself from this project's explicit member list. Since you can still administer it, you'll keep access — but you won't be scoped to it as a member anymore."
      : isSelf
        ? "You're removing yourself from this project. You will lose access to it."
        : `${memberLabel} will lose access to this project.`;

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isPending}
            aria-label={`Remove ${memberLabel} from this project`}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-4" aria-hidden="true" />
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove {isSelf ? "yourself" : memberLabel} from this project?
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRemove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Full member list -------------------------------------------------

export function ProjectMembersList({
  projectId,
  members,
  canManage,
  currentUserId,
  callerCanAdministerProject,
}: {
  projectId: string;
  members: ProjectMemberListItem[];
  canManage: boolean;
  currentUserId: string;
  /** True when the caller is a workspace owner/admin, or an existing
   * project lead — i.e. would still be able to administer this project
   * even after removing their own explicit membership row. */
  callerCanAdministerProject: boolean;
}) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No explicit project members yet. Add a workspace member below to
        scope them to this project.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {members.map((member) => {
        const label = member.name ?? member.email ?? "Unknown member";
        const isSelf = member.userId === currentUserId;

        return (
          <li
            key={member.id}
            className="flex items-center justify-between gap-3 p-3"
          >
            <div className="flex items-center gap-3">
              <UserAvatar
                person={{
                  id: member.userId,
                  name: member.name,
                  email: member.email,
                  avatarUrl: member.avatarUrl,
                }}
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {label}
                  {isSelf && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Added by {member.addedByName ?? "unknown"} on{" "}
                  {formatDate(member.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={member.projectRole === "lead" ? "default" : "secondary"}
                className="capitalize"
              >
                {member.projectRole}
              </Badge>
              {canManage && (
                <RemoveMemberButton
                  projectId={projectId}
                  userId={member.userId}
                  memberLabel={label}
                  isSelf={isSelf}
                  callerRetainsAccess={callerCanAdministerProject}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- Add-member picker ------------------------------------------------

export type AddableMember = {
  userId: string;
  name: string | null;
  email: string | null;
};

export function AddProjectMemberForm({
  projectId,
  addable,
}: {
  projectId: string;
  addable: AddableMember[];
}) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [role, setRole] = useState<"lead" | "member">("member");
  const [isPending, startTransition] = useTransition();

  if (addable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every active workspace member is already scoped to this project.
      </p>
    );
  }

  function handleAdd() {
    if (!selectedUserId) return;
    const person = addable.find((entry) => entry.userId === selectedUserId);
    const label = person?.name ?? person?.email ?? "Member";

    startTransition(async () => {
      const result = await addProjectMember(projectId, selectedUserId, role);
      if (result.ok) {
        toast.success(`${label} added to this project.`);
        setSelectedUserId(null);
        setRole("member");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-48 flex-col gap-1.5">
        <Label htmlFor="add-project-member-select">Workspace member</Label>
        <Select
          value={selectedUserId ?? undefined}
          onValueChange={(value) =>
            setSelectedUserId(typeof value === "string" ? value : null)
          }
          disabled={isPending}
        >
          <SelectTrigger id="add-project-member-select" className="w-56">
            <SelectValue placeholder="Choose a member" />
          </SelectTrigger>
          <SelectContent>
            {addable.map((entry) => (
              <SelectItem key={entry.userId} value={entry.userId}>
                {entry.name ?? entry.email ?? entry.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-project-member-role">Project role</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            if (value === "lead" || value === "member") setRole(value);
          }}
          disabled={isPending}
        >
          <SelectTrigger id="add-project-member-role" className="w-28">
            <SelectValue>
              {(value: string) => (value === "lead" ? "Lead" : "Member")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        onClick={handleAdd}
        disabled={isPending || !selectedUserId}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          "Add to project"
        )}
      </Button>
    </div>
  );
}

// --- Visibility toggle --------------------------------------------------

export type VisibilityLossEntry = {
  userId: string;
  name: string | null;
  email: string | null;
};

export function ProjectVisibilityToggle({
  projectId,
  visibility,
  lossPreview,
}: {
  projectId: string;
  visibility: "workspace" | "private";
  /** Who would lose access if switched to private. Only used/shown when
   * `visibility === "workspace"` and the caller is about to flip to
   * private. */
  lossPreview: VisibilityLossEntry[];
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function commit(next: "workspace" | "private") {
    startTransition(async () => {
      const result = await updateProjectVisibility(projectId, next);
      if (result.ok) {
        toast.success(
          next === "private"
            ? "This project is now private."
            : "This project is now visible to the whole workspace.",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggle(next: boolean) {
    const nextVisibility = next ? "private" : "workspace";
    // Switching TO private is the only direction that can revoke access
    // (AS-225's UI-side proof point) — warn first when there's anyone who
    // would actually lose it. Switching back to workspace-wide only ever
    // grants access, so it needs no confirmation.
    if (nextVisibility === "private" && lossPreview.length > 0) {
      setConfirmOpen(true);
      return;
    }
    commit(nextVisibility);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch
          checked={visibility === "private"}
          onCheckedChange={handleToggle}
          disabled={isPending}
          aria-label="Make this project private"
        />
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {visibility === "private" ? "Private" : "Workspace-wide"}
          </span>
          <span className="text-xs text-muted-foreground">
            {visibility === "private"
              ? "Only explicit project members and workspace owners/admins can see this project."
              : "Every active workspace member can see this project."}
          </span>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this project private?</AlertDialogTitle>
            <AlertDialogDescription>
              {lossPreview.length} workspace{" "}
              {lossPreview.length === 1 ? "member" : "members"} will lose
              access to this project because they aren&apos;t an explicit
              project member: {" "}
              {lossPreview
                .map((entry) => entry.name ?? entry.email ?? "Unknown member")
                .join(", ")}
              . You can add any of them back as explicit project members at
              any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                commit("private");
              }}
            >
              Make private
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
