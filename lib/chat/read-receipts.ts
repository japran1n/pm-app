// Read receipts: pure logic deciding which OTHER members (not the caller,
// not the message's own sender) have a read cursor
// (`channel_members.last_read_at`) at or after a given message's
// `createdAt`. Extracted to its own module (no React, no "use client",
// no server action imports) so it's unit-testable in Node without pulling
// in lib/actions/chat-messages.ts's `server-only` import chain -- same
// "plain, framework-free function" convention as lib/chat/subscribe-*.ts.

export type ReadReceiptMember = {
  userId: string;
};

export function computeLastMessageSeenBy<T extends ReadReceiptMember>(
  members: T[],
  readReceipts: Record<string, string | null>,
  currentUserId: string,
  lastMessage: { senderId: string; createdAt: string },
): T[] {
  const lastMessageAt = new Date(lastMessage.createdAt).getTime();
  return members.filter((m) => {
    if (m.userId === currentUserId) return false;
    if (m.userId === lastMessage.senderId) return false;
    const lastReadAt = readReceipts[m.userId];
    if (!lastReadAt) return false;
    return new Date(lastReadAt).getTime() >= lastMessageAt;
  });
}
