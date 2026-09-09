"use server";

// F019: the only place `ai_threads`/`ai_messages` are written to or read
// from. `lib/ai/use-doc-assistant.ts` (F008/F019) calls exclusively
// through these functions — never a direct Supabase client — so the RLS
// boundary these tables ship with (F018's migration,
// `supabase/migrations/20261118010000_ai_threads_ai_messages.sql`) is the
// single enforcement point, same convention `lib/actions/docs.ts` and
// `lib/actions/ai-proposals.ts` already follow.
//
// `workspaceId` is always a caller-supplied argument, never re-derived
// from anything client-controlled beyond that — per this feature's spec,
// "workspaceId comes from the sidebar props / hook args, never from
// client state" (the sidebar's own `workspaceId` prop is itself
// server-rendered per-page, same as every other server action in this
// codebase that takes a workspaceId).

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const TITLE_MAX_CHARS = 80;

export type ThreadMessageRole = "user" | "assistant";

export type ThreadMessageRow = {
  id: string;
  threadId: string;
  role: ThreadMessageRole;
  content: string;
  toolCalls: Json | null;
  proposals: Json | null;
  usage: Json | null;
  createdAt: string;
};

export type ThreadRow = {
  id: string;
  workspaceId: string;
  docId: string | null;
  projectId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessageRow[];
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function toTitle(firstUserMessage: string): string | null {
  const trimmed = firstUserMessage.trim();
  if (!trimmed) return null;
  return trimmed.length > TITLE_MAX_CHARS
    ? trimmed.slice(0, TITLE_MAX_CHARS)
    : trimmed;
}

/**
 * Creates a new `ai_threads` row. Title is the first 80 characters of the
 * turn that started the thread — same "first message becomes the label"
 * convention as most chat-thread UIs, and avoids a second round-trip just
 * to name the thread.
 */
export async function createThread(
  workspaceId: string,
  docId: string | null,
  projectId: string | null,
  firstUserMessage: string,
): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to start a conversation." };
  }

  const { data, error } = await supabase
    .from("ai_threads")
    .insert({
      workspace_id: workspaceId,
      doc_id: docId,
      project_id: projectId,
      title: toTitle(firstUserMessage),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("createThread: insert failed", { error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  return { id: data.id };
}

/**
 * Inserts one `ai_messages` row. `toolCalls`/`proposals`/`usage` are
 * stored verbatim as JSONB — enough detail to re-render the turn after a
 * reload (AS-084) without this action interpreting their shape.
 */
export async function addMessage(
  threadId: string,
  role: ThreadMessageRole,
  content: string,
  toolCalls: Json | null,
  proposals: Json | null,
  usage: Json | null,
): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to send a message." };
  }

  const { data, error } = await supabase
    .from("ai_messages")
    .insert({
      thread_id: threadId,
      role,
      content,
      tool_calls: toolCalls,
      proposals: proposals,
      usage,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("addMessage: insert failed", { error });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  return { id: data.id };
}

function mapThreadRow(
  thread: {
    id: string;
    workspace_id: string;
    doc_id: string | null;
    project_id: string | null;
    title: string | null;
    created_at: string;
    updated_at: string;
  },
  messages: Array<{
    id: string;
    thread_id: string;
    role: string;
    content: string;
    tool_calls: Json | null;
    proposals: Json | null;
    usage: Json | null;
    created_at: string;
  }>,
): ThreadRow {
  return {
    id: thread.id,
    workspaceId: thread.workspace_id,
    docId: thread.doc_id,
    projectId: thread.project_id,
    title: thread.title,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messages: messages.map((m) => ({
      id: m.id,
      threadId: m.thread_id,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      toolCalls: m.tool_calls,
      proposals: m.proposals,
      usage: m.usage,
      createdAt: m.created_at,
    })),
  };
}

/**
 * Loads the most recently updated thread for a workspace, with its
 * messages in order (AS-082). Returns null when the workspace has no
 * threads yet (fresh start — never an error, this is the ordinary
 * first-ever-conversation case).
 */
export async function getRecentThread(
  workspaceId: string,
): Promise<ThreadRow | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;

  const { data: thread, error: threadError } = await supabase
    .from("ai_threads")
    .select("id, workspace_id, doc_id, project_id, title, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (threadError) {
    logger.error("getRecentThread: select failed", { error: threadError });
    return null;
  }
  if (!thread) return null;

  const { data: messages, error: messagesError } = await supabase
    .from("ai_messages")
    .select("id, thread_id, role, content, tool_calls, proposals, usage, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    logger.error("getRecentThread: messages select failed", { error: messagesError });
    return mapThreadRow(thread, []);
  }

  return mapThreadRow(thread, messages ?? []);
}

/** Loads a specific thread with its messages in order, or null if it
 * doesn't exist / isn't visible to the caller (RLS). */
export async function getThread(threadId: string): Promise<ThreadRow | null> {
  const { supabase, user } = await requireUser();
  if (!user) return null;

  const { data: thread, error: threadError } = await supabase
    .from("ai_threads")
    .select("id, workspace_id, doc_id, project_id, title, created_at, updated_at")
    .eq("id", threadId)
    .maybeSingle();

  if (threadError || !thread) {
    if (threadError) logger.error("getThread: select failed", { error: threadError });
    return null;
  }

  const { data: messages, error: messagesError } = await supabase
    .from("ai_messages")
    .select("id, thread_id, role, content, tool_calls, proposals, usage, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    logger.error("getThread: messages select failed", { error: messagesError });
    return mapThreadRow(thread, []);
  }

  return mapThreadRow(thread, messages ?? []);
}

/**
 * Updates the `state` field of one proposal within a message's `proposals`
 * JSONB array, matched by `proposalId`. This is what makes a settled
 * decision (accepted/rejected) survive a reload (AS-085) — the row read
 * back afterwards must show the SAME state, never re-arming Accept.
 *
 * Reads the row, patches the matching entry in JS (not a Postgres JSONB
 * path expression), and writes the whole array back — the array is small
 * (one thread's worth of proposals in one turn) and this keeps the shape
 * this action reads/writes identical to what `addMessage` wrote, rather
 * than depending on a specific JSONB structure surviving a partial-path
 * update untouched.
 */
export async function updateProposalState(
  threadId: string,
  messageId: string,
  proposalId: string,
  state: "accepted" | "rejected",
): Promise<{ ok: true } | { error: string }> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "You must be signed in to update a proposal." };
  }

  const { data: message, error: fetchError } = await supabase
    .from("ai_messages")
    .select("id, thread_id, proposals")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .maybeSingle();

  if (fetchError || !message) {
    logger.error("updateProposalState: message fetch failed", { error: fetchError });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  const proposalsList = Array.isArray(message.proposals)
    ? (message.proposals as Array<Record<string, Json>>)
    : [];

  let found = false;
  const nextProposals = proposalsList.map((proposal) => {
    if (
      proposal &&
      typeof proposal === "object" &&
      !Array.isArray(proposal) &&
      (proposal as { id?: unknown }).id === proposalId
    ) {
      found = true;
      return { ...proposal, state };
    }
    return proposal;
  });

  if (!found) {
    // Nothing to update — not an error (the proposal may have been
    // rendered from a live stream event whose message row hasn't
    // persisted the proposal payload under this id, or a stale id). Callers
    // treat this as best-effort persistence, matching this action's role
    // as "make the settle survive reload", not the source of truth for
    // whether the transition itself is valid.
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("ai_messages")
    .update({ proposals: nextProposals as unknown as Json })
    .eq("id", messageId)
    .eq("thread_id", threadId);

  if (updateError) {
    logger.error("updateProposalState: update failed", { error: updateError });
    return { error: "Something went wrong. Please try again in a moment." };
  }

  return { ok: true };
}
