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
import { searchInputSchema } from "@/lib/validation/palette-search";

export async function searchMessages(
  workspaceId: string,
  query: string,
): Promise<MessageSearchResult[]> {
  // Audit NX-008: zod boundary — malformed args return empty instead of
  // reaching the query layer.
  const parsed = searchInputSchema.safeParse({ workspaceId, query });
  if (!parsed.success || !parsed.data.query.trim()) return [];
  return searchChannelMessages(parsed.data.workspaceId, parsed.data.query);
}
