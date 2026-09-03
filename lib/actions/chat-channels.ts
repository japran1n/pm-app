"use server";
import { logger } from "@/lib/observability/logger";


// F2 (docs/advanced-chat-plan.md): Server Actions for channel creation and
// membership. Pattern mirrors lib/actions/comments.ts / lib/actions/tasks.ts:
// Zod validation -> auth.getUser() -> requireActiveMembership (defense in
// depth, AS-143 convention) -> admin-client write -> revalidate.
//
// Writes go through the admin client because this action has already
// independently re-verified membership/visibility itself, same rationale
// documented at the top of addComment in lib/actions/comments.ts.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createChannelSchema,
  addChannelMemberSchema,
  removeChannelMemberSchema,
} from "@/lib/validation/chat";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";

function revalidateChat() {
  try {
    // Same "don't know the exact workspaceSlug, revalidate the shared root"
    // convention docs.ts uses — this action layer only has a workspaceId,
    // not the slug used in the /w/[workspaceSlug] route segment.
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("chat-channels action: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export type CreateChannelResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

// Creates a channel (or a DM thread) and enrolls the creator plus any
// explicitly listed members. Per the plan's spec: if project-scoped,
// re-verify project visibility for the caller; the channel insert + member
// inserts happen atomically inside the `create_channel_atomic` RPC (W7e
// hardening -- see the comment just above that RPC call below for why this
// replaced an earlier hand-rolled compensating-delete rollback).
export async function createChannel(input: {
  workspaceId: string;
  kind: "channel" | "dm";
  name?: string | null;
  projectId?: string | null;
  memberIds?: string[];
}): Promise<CreateChannelResult> {
  const parsed = createChannelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid channel details.",
    };
  }

  const { user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to create a channel." };
  }

  const admin = createAdminClient();

  const membership = await requireActiveMembership(
    admin,
    parsed.data.workspaceId,
    user.id,
  );
  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a channel in this workspace.",
    };
  }

  const projectId = parsed.data.projectId ?? null;

  if (projectId) {
    const { data: projectRow, error: projectError } = await admin
      .from("projects")
      .select("id, visibility, workspace_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !projectRow || projectRow.workspace_id !== parsed.data.workspaceId) {
      return { ok: false, error: "Project not found." };
    }

    const visible = await isProjectVisibleToCaller(
      admin,
      {
        projectId,
        visibility: (projectRow.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      membership.role,
    );

    if (!visible) {
      return { ok: false, error: "Project not found." };
    }
  }

  // Creator + any explicitly listed members, de-duplicated.
  const memberIds = Array.from(
    new Set([user.id, ...(parsed.data.memberIds ?? [])]),
  );

  // W7e hardening (missions/20260828-hardening/w7-atomicity-triage.md): both
  // inserts (the channel row and its member rows) now happen inside a
  // single SECURITY DEFINER function, `create_channel_atomic`
  // (supabase/migrations/20260905090000_create_channel_atomic.sql), invoked
  // as one RPC call. A single function body runs in one implicit
  // transaction, so if the member insert fails, Postgres rolls back the
  // channel insert too -- there is no manual compensating delete step, and
  // therefore no window where that rollback step can itself fail and leave
  // an orphaned, memberless channel behind.
  //
  // F002b: `p_project_id`/`p_name` now default to null in the RPC's own
  // signature (supabase/migrations/20260910010000_create_channel_atomic_
  // nullable_args.sql), so `supabase gen types typescript` emits them as
  // optional. Keys are only included below when there's an actual value --
  // same "conditional spread, never assign an explicit null" pattern
  // lib/notifications/create-notification.ts already uses for
  // create_notification's own optional/nullable RPC args -- rather than
  // passing `projectId`/`name` straight through, which the generated Args
  // type (correctly) doesn't accept as nullable.
  const name = parsed.data.kind === "channel" ? (parsed.data.name?.trim() ?? null) : null;

  const { data: channelId, error: rpcError } = await admin.rpc(
    "create_channel_atomic",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_kind: parsed.data.kind,
      p_created_by: user.id,
      p_member_ids: memberIds,
      ...(projectId ? { p_project_id: projectId } : {}),
      ...(name ? { p_name: name } : {}),
    },
  );

  if (rpcError || !channelId) {
    logger.error("createChannel: create_channel_atomic RPC failed", { error: rpcError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateChat();

  return { ok: true, data: { id: channelId as string } };
}

export type AddChannelMemberResult = { ok: true } | { ok: false; error: string };

// Adds a member to a channel. Per the plan's explicit acceptance test: a
// non-member cannot add themselves (or anyone else) to a private/DM
// channel they don't already belong to — enforced here by requiring the
// caller to already be a channel_members row before this action inserts
// anyone (mirrors channel_members_insert_self_or_existing_member RLS, which
// this admin-client write bypasses and must therefore re-check itself).
export async function addChannelMember(
  channelId: string,
  userId: string,
): Promise<AddChannelMemberResult> {
  const parsed = addChannelMemberSchema.safeParse({ channelId, userId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const { user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage channel members." };
  }

  const admin = createAdminClient();

  const { data: channelRow, error: channelError } = await admin
    .from("channels")
    .select("id, workspace_id, kind")
    .eq("id", parsed.data.channelId)
    .maybeSingle();

  if (channelError || !channelRow) {
    return { ok: false, error: "Channel not found." };
  }

  const { data: callerMembership } = await admin
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", user.id)
    .maybeSingle();

  // A workspace-wide 'channel' (not a DM) that's visible to the caller via
  // active workspace membership may be self-joined even without an
  // existing channel_members row yet (auto-enroll / "browse and join" use
  // case). Anything else (private channel someone else created without
  // adding the caller, or any DM) requires the caller to already be a
  // member before they can add anyone, including themselves.
  let callerMayAdd = !!callerMembership;

  if (!callerMayAdd && channelRow.kind === "channel" && userId === user.id) {
    const membership = await requireActiveMembership(admin, channelRow.workspace_id, user.id);
    callerMayAdd = membership.ok;
  }

  if (!callerMayAdd) {
    return { ok: false, error: "You don't have permission to add members to this channel." };
  }

  const { error: insertError } = await admin
    .from("channel_members")
    .insert({ channel_id: parsed.data.channelId, user_id: parsed.data.userId })
    .select("channel_id")
    .maybeSingle();

  if (insertError) {
    // Duplicate (channel_id, user_id) primary key -> already a member,
    // treat as a no-op success rather than a user-facing error.
    if (insertError.code === "23505") {
      return { ok: true };
    }
    logger.error("addChannelMember: insert failed", { error: insertError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateChat();

  return { ok: true };
}

export type RemoveChannelMemberResult = { ok: true } | { ok: false; error: string };

export async function removeChannelMember(
  channelId: string,
  userId: string,
): Promise<RemoveChannelMemberResult> {
  const parsed = removeChannelMemberSchema.safeParse({ channelId, userId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const { user } = await requireUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to manage channel members." };
  }

  const admin = createAdminClient();

  const { data: callerMembership } = await admin
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Leaving yourself is always allowed if you're a member; removing
  // someone else requires the caller to already be a member of that same
  // channel (mirrors channel_members_delete_self_or_existing_member RLS).
  // Both cases require an active membership — the distinction is preserved
  // here for future role-based enforcement if needed.
  const callerMayRemove = !!callerMembership;

  if (!callerMayRemove) {
    return { ok: false, error: "You don't have permission to remove this member." };
  }

  const { error: deleteError } = await admin
    .from("channel_members")
    .delete()
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", parsed.data.userId);

  if (deleteError) {
    logger.error("removeChannelMember: delete failed", { error: deleteError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  revalidateChat();

  return { ok: true };
}
