import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { getPortalProjects, getPortalRequests } from "@/lib/queries/portal";
import { getChannelMessages, getChannelMembers, getReplyCounts } from "@/lib/queries/chat";
import { createClient } from "@/lib/supabase/server";
import { createClientRequest } from "@/lib/actions/client-requests";
import { ChannelView } from "@/components/chat/channel-view";
import { RequestList } from "@/components/portal/request-list";
import { EmptyState } from "@/components/empty-state";

// F116 (docs/client-portal-phase-2-plan.md item A): the portal's
// conversation view. Reuses the same ChannelView Client Component the
// staff-side `/w/<slug>/chat/<channelId>` route already renders (this file
// mirrors that route's own Server Component shape almost exactly -- see
// app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx) rather than
// building a second chat UI, per this feature's own "do not build a
// messaging system" instruction.
//
// Project resolution goes through `getPortalProjects`, the same RLS +
// `portal_enabled` filtered list every other portal view in this segment
// uses (see e.g. site/page.tsx's own comment) -- a project that doesn't
// exist, isn't shared with this client, or has `portal_enabled = false`
// all end at the same notFound(), same AS-007-style convention.
//
// The channel itself is looked up by `project_id` + `kind = 'channel'`
// rather than by a stored id anywhere in the portal's own tables --
// `ensure_project_channel_atomic` (20261103010000) is this project's
// single source of truth for which channel that is, and RLS's
// `channels_select_members_or_workspace` policy is what actually decides
// whether this client may see it (an explicit `channel_members` row,
// never workspace-visibility browsing -- see that migration's own header
// comment for why). A project whose portal just turned on a moment ago,
// before `ensure_project_channel_atomic` has run, or a client not yet
// backfilled onto it, gets the honest empty state below instead of a 500 --
// silence here reads as "not started yet", not as broken.
export default async function PortalConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ mention?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const { mention: mentionUserId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  const workspaceId = workspace?.id ?? "";

  const workspaceProjects = await getPortalProjects(workspaceId);
  const project = workspaceProjects.find((p) => p.id === projectId);
  if (!project) notFound();

  // F007 (portal-simplify, AS-012/AS-013): a client's requests for THIS
  // project, same "read stays wide, this caller narrows it" convention
  // `p/[projectId]/requests/page.tsx` already established for the same
  // workspace-wide `getPortalRequests` read (see that file's own comment).
  const allRequests = await getPortalRequests(workspaceId);
  const requests = allRequests.filter((request) => request.projectId === projectId);

  // F007: an inline Server Action (closes over this route's own
  // `projectId`) so the checkbox in MessageComposer -- gated by
  // `onFileRequest` -- files a request against exactly this project, never
  // a caller-supplied one. Delegates entirely to the existing
  // `createClientRequest` action (same validation, same notification,
  // same RLS re-check) via a FormData built here, rather than duplicating
  // any of that logic.
  async function fileMessagesRequest(payload: {
    title: string;
    body: string;
  }): Promise<{ ok: boolean; error?: string }> {
    "use server";
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("title", payload.title);
    formData.set("body", payload.body);
    const result = await createClientRequest(null, formData);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id, name")
    .eq("project_id", projectId)
    .eq("kind", "channel")
    .maybeSingle();

  // F017 (portal-simplify design pass): page-header spacing per the
  // design system's own rule ("Page headers p-6 pt-4 lg:p-8 lg:pt-8"),
  // replacing the bespoke p-4/pb-0 this route had drifted to.
  const header = (
    <div className="flex flex-col gap-1 p-6 pt-4 lg:p-8 lg:pt-8">
      {/* F018 (UX validation defect, cosmetic): the topbar already prints
          this route's title ("Messages", `portal-topbar.tsx`'s own
          `STATIC_ROUTE_TITLES` map) above this page's content -- this was
          a second, visually duplicate "Messages" directly below it. Kept
          as an `sr-only` heading (not deleted outright) so the page still
          has its own accessible `<h1>` for screen readers/landmark
          navigation, matching the sibling routes that render no visible
          body title at all (pages/hours/results/scope/site/architecture). */}
      <h1 className="sr-only">Messages</h1>
      <p className="text-sm text-muted-foreground">
        Talk to the team, or ask for something new.
      </p>
    </div>
  );

  // F015 (portal-simplify, AS-012): with an unbounded requests list this
  // section could grow tall enough to push the chat + composer off
  // screen entirely on a long-running project. Capped at its own
  // max-height with its own internal scroll, same "each region scrolls
  // itself" pattern `ChannelView`'s message list already uses, so the
  // conversation above always stays visible.
  const requestsSection = (
    <div className="flex max-h-64 flex-col gap-3 overflow-y-auto p-4">
      <h2 className="sticky top-0 bg-background text-sm font-medium text-muted-foreground">
        Your requests
      </h2>
      <RequestList requests={requests} projectId={project.id} />
    </div>
  );

  if (!channel) {
    return (
      <div className="flex h-full flex-col gap-4">
        {header}
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={MessageSquare}
            title="No conversation yet"
            description="Once your team starts this project's conversation, you'll see it here."
            testId="portal-conversation-empty"
          />
        </div>
        {requestsSection}
      </div>
    );
  }

  const [messages, members, replyCounts] = await Promise.all([
    getChannelMessages(channel.id),
    getChannelMembers(channel.id),
    getReplyCounts(channel.id),
  ]);

  // "Piši nam" (Paket E): resolve the ?mention=<userId> query param (the
  // team card's own link shape) against this channel's already-fetched
  // member list, so ChannelView can prefill "@Name " without a second
  // lookup. An unknown/stale id (member removed since the link was
  // generated) just falls back to no prefill, same "silence over broken
  // state" convention as this page's own notFound()-vs-empty-state calls.
  const mentionMember = mentionUserId
    ? members.find((m) => m.userId === mentionUserId)
    : undefined;

  return (
    <div className="flex h-full flex-col gap-4">
      {header}
      <div className="min-h-0 flex-1">
        <ChannelView
          workspaceSlug={workspaceSlug}
          channelId={channel.id}
          channelName={channel.name ?? project.name}
          initialMessages={messages}
          members={members}
          currentUserId={user.id}
          initialReplyCounts={replyCounts}
          initialMentionName={mentionMember?.name ?? mentionMember?.email ?? undefined}
          onFileRequest={fileMessagesRequest}
        />
      </div>
      {requestsSection}
    </div>
  );
}
