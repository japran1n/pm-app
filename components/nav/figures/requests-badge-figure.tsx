// F016 (AS-017): the "Client requests" nav item's own async server
// component. Same shape as `approvals-badge-figure.tsx` (see that file's
// own header comment) -- fetches F015's
// `getOpenClientRequestCountForWorkspace` itself instead of the layout
// awaiting it, wrapped by the layout in its own `<Suspense
// fallback={null}>`. Renders the exact same badge markup the layout used
// to render inline from a `count` number.
import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";
import { Badge } from "@/components/ui/badge";

export async function RequestsBadgeFigure({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { count } = await getOpenClientRequestCountForWorkspace(workspaceId);

  if (!(typeof count === "number" && count > 0)) {
    return null;
  }

  return (
    <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-mono">
      {count}
    </Badge>
  );
}
