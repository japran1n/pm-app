"use client";

// F019 (AS-014/AS-015/AS-019): owner-only role control for an active
// member row. Same "smallest possible client boundary" convention as
// RevokeInviteButton — the members page (Server Component) renders
// everything else; this is only the interactive role-change control.
//
// Visibility here is a UI-only convenience gate (the members page only
// renders this component at all when `canChangeRoles` — the caller's own
// role is "owner" — per F017's existing `canInvite` pattern). The actual
// permission check lives server-side in `changeMemberRole` itself
// (re-checks owner specifically, not just admin), so hiding this control
// for non-owners is not the security boundary — AS-015 requires the
// server-side rejection regardless of what the UI shows.

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

export function MemberRoleSelect({
  workspaceId,
  workspaceMemberId,
  role,
  memberLabel,
}: {
  workspaceId: string;
  workspaceMemberId: string;
  role: "admin" | "member";
  memberLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    if (value !== "member" && value !== "admin") return;
    if (value === role) return;

    startTransition(async () => {
      const result = await changeMemberRole(
        workspaceId,
        workspaceMemberId,
        value,
      );
      if (result.ok) {
        toast.success(`${memberLabel}'s role changed to ${value}.`);
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
            {(value: string) => (value === "admin" ? "Admin" : "Member")}
          </SelectValue>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">Member</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
