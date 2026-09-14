"use client";

// F009 (AS-023): the client's "Sent" request inbox, kept live via
// Realtime on `client_requests` -- a new request they just filed, or a
// status change made from the team's side (moved to review, accepted,
// declined), lands without a reload. Seeded entirely from the
// server-rendered `requests` prop; the subscription only ever patches
// that seed.
//
// No row filter is applied on the channel -- `client_requests`'s RLS
// policy (`client_requests_select_author_or_team`, see
// lib/queries/portal.ts) already scopes what Realtime will ever deliver to
// this session to rows this caller is allowed to see, same reasoning
// use-my-tasks-realtime.ts documents for `task_assignees`/`tasks`. F016e
// (missions/20260903-portal, M3-scrutiny defect 2): that policy is now
// project-scoped, not `created_by`-scoped, so this list -- like every
// other portal surface reading `client_requests` -- can receive an
// update from a request a DIFFERENT client user on the same project
// filed, not only ones this session's own user authored.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

import { withdrawClientRequest } from "@/lib/actions/client-requests";
import type { PortalRequest } from "@/lib/queries/portal";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import { createClient } from "@/lib/supabase/client";
import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";

const STATUS_LABEL: Record<PortalRequest["status"], string> = {
  submitted: "Waiting for review",
  in_review: "Being reviewed",
  accepted: "Accepted",
  declined: "Declined",
};

// F017 (portal-simplify design pass): status renders as the design
// system's own pill badge (uppercase, 9px, tracking-[0.07em], 1px
// border, 10% tint -- see components/ui/badge.tsx's own header comment)
// instead of a bare coloured span, and the two hard-coded Tailwind
// colours (`text-blue-600`, `text-emerald-600`) are gone in favour of the
// badge's existing semantic variants -- colours are derived from the six
// design-system knobs, never hand-written here.
const STATUS_BADGE_VARIANT: Record<
  PortalRequest["status"],
  VariantProps<typeof badgeVariants>["variant"]
> = {
  submitted: "secondary",
  in_review: "warning",
  accepted: "success",
  declined: "destructive",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Raw `client_requests` row shape as it arrives over Realtime --
// snake_case columns, no join to `projects`/`tasks`, so `projectName` and
// the converted-task fields are not present on the payload itself.
type RawRequestRow = {
  id: string;
  project_id?: string;
  title?: string;
  body?: string | null;
  desired_by?: string | null;
  status?: PortalRequest["status"];
  decline_reason?: string | null;
  converted_task_id?: string | null;
  created_at?: string;
  [key: string]: unknown;
};

function mergeIncomingRequest(
  raw: RawRequestRow,
  existing: PortalRequest | undefined,
): PortalRequest | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    projectId: raw.project_id ?? existing?.projectId ?? "",
    // Not carried on the raw row -- kept from whatever this session
    // already knew about the project (e.g. an earlier request to the same
    // project), otherwise left blank rather than guessed.
    projectName: existing?.projectName ?? "",
    title: raw.title ?? existing?.title ?? "",
    body: raw.body !== undefined ? raw.body : (existing?.body ?? null),
    desiredBy:
      raw.desired_by !== undefined ? raw.desired_by : (existing?.desiredBy ?? null),
    status: raw.status ?? existing?.status ?? "submitted",
    declineReason:
      raw.decline_reason !== undefined
        ? raw.decline_reason
        : (existing?.declineReason ?? null),
    convertedTaskId:
      raw.converted_task_id !== undefined
        ? raw.converted_task_id
        : (existing?.convertedTaskId ?? null),
    // Not carried on the raw row -- see projectName above.
    convertedTaskTitle: existing?.convertedTaskTitle ?? null,
    convertedTaskStatus: existing?.convertedTaskStatus ?? null,
    createdAt: raw.created_at ?? existing?.createdAt ?? new Date().toISOString(),
  };
}

export function subscribeToPortalRequestListRealtime(
  supabase: SupabaseClient,
  onChange: (updater: (current: PortalRequest[]) => PortalRequest[]) => void,
): () => void {
  const topic = "portal:client-requests";

  return acquireSharedTopicChannel<
    RealtimePostgresChangesPayload<RawRequestRow>
  >(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "client_requests" },
          (payload: RealtimePostgresChangesPayload<RawRequestRow>) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    (event) => {
      // AS-023: insert and status-change land live. Deletes are not part
      // of this assertion (requests are withdrawn via the existing
      // server action + `router.refresh()` path, not a client-visible
      // Realtime delete), so only INSERT/UPDATE are handled here.
      if (event.eventType !== "INSERT" && event.eventType !== "UPDATE") return;

      onChange((current) => {
        const raw = event.new as RawRequestRow;
        const existing = current.find((request) => request.id === raw.id);
        const merged = mergeIncomingRequest(raw, existing);
        if (!merged) return current;

        if (existing) {
          return current.map((request) =>
            request.id === merged.id ? merged : request,
          );
        }
        return [merged, ...current];
      });
    },
  );
}

export function RequestList({
  requests,
  projectId,
}: {
  requests: PortalRequest[];
  /** F079 (missions/20260903-portal audit, defect 2): when set, scopes
   * both the seeded list AND every live Realtime insert/update to this
   * one project -- the channel itself
   * (`subscribeToPortalRequestListRealtime`) has no server-side row
   * filter (its own comment explains why: RLS already gates what a
   * caller's session can receive at all), so without this the list could
   * still admit a live row from a DIFFERENT project of the same
   * workspace even after the initial server-rendered list was scoped to
   * one project. Omitted (undefined) on the workspace-wide caller, if
   * one is ever added back, which keeps every project's rows exactly as
   * today. */
  projectId?: string;
}) {
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [liveRequests, setLiveRequests] = useState<PortalRequest[]>(requests);
  // A fresh server-rendered list (e.g. after `router.refresh()` on
  // withdraw) always wins over whatever this session's subscription has
  // accumulated so far -- tracked so the reset can happen during render
  // rather than in a post-commit effect.
  const [seededRequests, setSeededRequests] = useState(requests);
  if (requests !== seededRequests) {
    setSeededRequests(requests);
    setLiveRequests(requests);
  }
  // See TeamRequestInbox: an action called from an event handler needs an
  // explicit refresh for its revalidation to reach the screen.
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    // F023: awaits session hydration before subscribing (see
    // lib/realtime/subscribe-when-authenticated.ts) -- without it, a
    // channel created on a fresh page load joins unauthenticated and the
    // RLS-gated inserts/updates AS-023 depends on are silently filtered
    // out.
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToPortalRequestListRealtime(client, (updater) =>
        setLiveRequests((current) => {
          const next = updater(current);
          return projectId ? next.filter((r) => r.projectId === projectId) : next;
        }),
      ),
    );
  }, [projectId]);

  if (liveRequests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">No requests yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anything you send will show up here with its status.
        </p>
      </div>
    );
  }

  const handleWithdraw = (requestId: string) => {
    setWithdrawingId(requestId);
    startTransition(async () => {
      const result = await withdrawClientRequest(requestId);
      setWithdrawingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Request withdrawn.");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-medium tracking-tight">Sent</h2>

      <ul className="flex flex-col gap-3">
        {liveRequests.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{request.title}</span>
                <span className="text-xs text-muted-foreground">
                  {request.projectName} · sent{" "}
                  <span className="font-mono">{formatDate(request.createdAt)}</span>
                  {request.desiredBy ? (
                    <>
                      {" "}
                      · needed by{" "}
                      <span className="font-mono">{formatDate(request.desiredBy)}</span>
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>

              <Badge variant={STATUS_BADGE_VARIANT[request.status]}>
                {STATUS_LABEL[request.status]}
              </Badge>
            </div>

            {request.body && (
              <p className="text-sm text-muted-foreground">{request.body}</p>
            )}

            {/* The decision, in the client's own view. A bare "declined"
                with the reason living only in the team's inbox is what
                produces the follow-up email asking why. */}
            {request.status === "declined" && request.declineReason && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {request.declineReason}
              </p>
            )}

            {request.status === "accepted" && (
              <p className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
                {request.convertedTaskTitle
                  ? `On the board as "${request.convertedTaskTitle}"${
                      request.convertedTaskStatus
                        ? ` — ${request.convertedTaskStatus.replace(/_/g, " ")}`
                        : ""
                    }.`
                  : "Accepted and added to the project."}
              </p>
            )}

            {request.status === "submitted" && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleWithdraw(request.id)}
                  disabled={isPending && withdrawingId === request.id}
                >
                  {isPending && withdrawingId === request.id ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Withdrawing...
                    </>
                  ) : (
                    "Withdraw"
                  )}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
