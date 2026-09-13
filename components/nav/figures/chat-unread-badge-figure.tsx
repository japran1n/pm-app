// F016 (AS-017): the "Chat" nav item's own async server component. Same
// shape as `approvals-badge-figure.tsx`/`requests-badge-figure.tsx` (see
// those files' own header comments) -- fetches
// `getWorkspaceChatUnreadTotal` itself instead of the layout awaiting it,
// wrapped by the layout in its own `<Suspense fallback={null}>`. Keeps the
// same non-fatal, fails-open-to-0 convention the layout used to apply at
// its own call site.
import { logger } from "@/lib/observability/logger";
import { getWorkspaceChatUnreadTotal } from "@/lib/queries/chat";
import { Badge } from "@/components/ui/badge";

export async function ChatUnreadBadgeFigure({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const count = await getWorkspaceChatUnreadTotal(workspaceId).catch((error) => {
    logger.error("ChatUnreadBadgeFigure: failed to look up chat unread total for sidebar", { error });
    return 0;
  });

  if (!(typeof count === "number" && count > 0)) {
    return null;
  }

  return (
    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
      {count}
    </Badge>
  );
}
