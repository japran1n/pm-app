"use server";

// F12 (docs/advanced-chat-plan.md): thin Server Action wrapper around
// lib/queries/chat.ts's searchChannelMessages -- the query module is
// `server-only` (see its top-of-file import), so the client-side search
// input (components/chat/chat-message-search.tsx) reaches it through this
// action, same "use server" boundary every other chat client component
// crosses (lib/actions/chat-messages.ts, lib/actions/chat-reactions.ts).

import {
  searchChannelMessages,
  type MessageSearchResult,
} from "@/lib/queries/chat";

export async function searchMessages(
  workspaceId: string,
  query: string,
): Promise<MessageSearchResult[]> {
  if (!workspaceId || !query.trim()) return [];
  return searchChannelMessages(workspaceId, query);
}
