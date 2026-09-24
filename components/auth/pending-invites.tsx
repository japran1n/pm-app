"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import {
  acceptInvite,
  declineInvite,
  type InviteResponseResult,
} from "@/lib/actions/invite-response";
import { Button } from "@/components/ui/button";

export interface PendingInviteItem {
  id: string;
  workspaceName: string;
  role: string;
}

const initialState: InviteResponseResult | null = null;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
  client: "Client",
};

function PendingInviteRow({ invite }: { invite: PendingInviteItem }) {
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptInvite,
    initialState,
  );
  const [declineState, declineAction, declining] = useActionState(
    declineInvite,
    initialState,
  );
  const busy = accepting || declining;
  const error =
    (acceptState?.ok === false && acceptState.error) ||
    (declineState?.ok === false && declineState.error) ||
    null;
  const errorId = `invite-error-${invite.id}`;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{invite.workspaceName}</p>
        <p className="text-sm text-muted-foreground">
          Join as {ROLE_LABELS[invite.role] ?? invite.role}
        </p>
      </div>

      <form className="flex gap-2" aria-describedby={error ? errorId : undefined}>
        <input type="hidden" name="inviteId" value={invite.id} />
        <Button
          type="submit"
          formAction={acceptAction}
          disabled={busy}
          className="flex-1"
        >
          {accepting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Joining...
            </>
          ) : (
            "Accept"
          )}
        </Button>
        <Button
          type="submit"
          variant="outline"
          formAction={declineAction}
          disabled={busy}
          className="flex-1"
        >
          {declining ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Declining...
            </>
          ) : (
            "Decline"
          )}
        </Button>
      </form>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function PendingInvites({ invites }: { invites: PendingInviteItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {invites.map((invite) => (
        <PendingInviteRow key={invite.id} invite={invite} />
      ))}
    </ul>
  );
}
