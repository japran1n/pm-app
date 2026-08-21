"use client";

// F019 (AS-014/AS-015/AS-019) → F129 (AS-218/AS-219/AS-232/AS-235):
// owner/admin role control for an active member row, extended from the
// original "member"/"admin" pair to the full 5-role set added by F126
// ("owner" | "admin" | "member" | "viewer" | "guest").
//
// Visibility here is a UI-only convenience gate (the members page only
// renders this component at all when `canManageMembers` — the caller's own
// role is owner or admin, per AS-218 — and never for a target row that is
// itself "owner", which the page renders as a plain badge instead — see
// that page's comment for why demoting an owner through this control is
// left out of the UI surface for now). The actual permission check lives
// server-side in `changeMemberRole` itself (re-checks owner/admin
// specifically), so hiding this control for non-owners/admins is not the
// security boundary — AS-015's mission-1 negative case (and AS-235 here)
// requires the server-side rejection regardless of what the UI shows.
//
// "owner" is deliberately not one of this control's selectable values —
// granting ownership through a role-change action is out of scope (see
// changeMemberRoleSchema); an owner's row is never passed to this
// component as `role` either, since the page renders it as a badge.

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { changeMemberRole } from "@/lib/actions/workspaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EditableRole = "admin" | "member" | "viewer" | "guest";

// AS-235's simpler-option choice (recorded in the F129 handoff): promoting
// a guest to admin is a single UI action that the server rejects — not a
// two-step wizard. The description text below spells that constraint out
// next to the "Admin" option so the (still-shown, still-clickable) control
// doesn't surprise a caller who picks it for a guest; the actual rejection
// still happens server-side either way.
const ROLE_META: Record<
  EditableRole,
  { label: string; description: string }
> = {
  admin: {
    label: "Admin",
    description: "Manages members, settings, and every project.",
  },
  member: {
    label: "Member",
    description: "Full access to create and edit tasks across projects.",
  },
  viewer: {
    label: "Viewer",
    description: "Can see everything but cannot create or edit.",
  },
  guest: {
    label: "Guest",
    description: "Limited to the specific project(s) they were added to.",
  },
};

function isEditableRole(value: string): value is EditableRole {
  return value === "admin" || value === "member" || value === "viewer" || value === "guest";
}

export function MemberRoleSelect({
  workspaceId,
  workspaceMemberId,
  role,
  memberLabel,
}: {
  workspaceId: string;
  workspaceMemberId: string;
  role: EditableRole;
  memberLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    if (!value || !isEditableRole(value)) return;
    if (value === role) return;

    startTransition(async () => {
      const result = await changeMemberRole(
        workspaceId,
        workspaceMemberId,
        value,
      );
      if (result.ok) {
        toast.success(`${memberLabel}'s role changed to ${ROLE_META[value].label}.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Select value={role} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger
        size="sm"
        className="w-28"
        aria-label={`Change role for ${memberLabel}`}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <SelectValue>
            {(value: string) =>
              isEditableRole(value) ? ROLE_META[value].label : value
            }
          </SelectValue>
        )}
      </SelectTrigger>
      <SelectContent className="min-w-64">
        {(Object.keys(ROLE_META) as EditableRole[]).map((value) => (
          <SelectItem key={value} value={value}>
            <div className="flex flex-col gap-0.5 py-0.5">
              <span className="font-medium">{ROLE_META[value].label}</span>
              <span className="text-xs text-muted-foreground">
                {ROLE_META[value].description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
