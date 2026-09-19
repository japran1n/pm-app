import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// F013 (TH-030, TH-031, TH-032, TH-033): a small presentational card for
// one entry on the "Tools" index page (app/(workspace)/w/[workspaceSlug]/
// tools/page.tsx). Deliberately dumb/stateless -- no data fetching, no
// client-side state -- so the index page itself stays a pure Server
// Component with zero Supabase queries beyond what the shared workspace
// layout already does (TH-036), and so a third tool is a one-line addition
// to that page's own `tools` array rather than a new component.
export function ToolCard({
  href,
  icon: Icon,
  name,
  description,
}: {
  href: string;
  icon: LucideIcon;
  name: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-md border border-border bg-card p-4 shadow-xs transition-colors hover:border-border-control-hover"
    >
      <div className="flex items-center gap-2.5">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{name}</span>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
