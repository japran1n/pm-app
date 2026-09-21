// F006 (AS-020..AS-026): the Home dashboard's "Needs you" card — a single
// inbox-like list combining pending approvals, client requests, mentions,
// and QA returns that need the caller's attention, capped at 10 rows with
// an overflow link to the full inbox.
//
// Server Component: purely presentational, no client interactivity. Action
// buttons are plain <a> links to the relevant page, never form submissions
// (the underlying action — approve/reply/etc — happens on the destination
// page, not from this card).
//
// Role gating (client_request hidden from 'member' role) is done by the
// caller (page.tsx) before items are passed in — this component renders
// whatever it is given.

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const MAX_ITEMS = 10;

export type AttentionItem = {
  id: string;
  kind: "approval" | "client_request" | "mention" | "qa_return";
  title: string;
  subtitle: string;
  actionLabel: string;
  actionHref: string;
};

export type NeedsYouCardProps = {
  items: AttentionItem[];
  totalCount: number;
  role: WorkspaceRole;
  workspaceSlug: string;
};

const KIND_ICON_STYLES: Record<AttentionItem["kind"], string> = {
  approval: "bg-violet-500/10 text-violet-500",
  client_request: "bg-blue-500/10 text-blue-500",
  mention: "bg-muted text-muted-foreground",
  qa_return: "bg-amber-500/10 text-amber-500",
};

export function NeedsYouCard({
  items,
  totalCount,
  workspaceSlug,
}: NeedsYouCardProps) {
  const visibleItems = items.slice(0, MAX_ITEMS);
  const overflowCount = totalCount - visibleItems.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 [.border-b]:pb-4">
        <div className="flex items-center gap-2">
          <CardTitle>Needs you</CardTitle>
          {totalCount > 0 ? (
            <Badge variant="destructive">{totalCount}</Badge>
          ) : null}
        </div>
        <Link
          href={`/w/${workspaceSlug}/notifications`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Inbox &rarr;
        </Link>
      </CardHeader>
      <CardContent>
        {visibleItems.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 py-8 text-center">
            <CheckCircle2 className="size-6 text-brand" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              You&apos;re all caught up &#10003;
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {visibleItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    KIND_ICON_STYLES[item.kind]
                  )}
                  aria-hidden="true"
                >
                  <span className="size-2 rounded-full bg-current" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {item.subtitle}
                  </p>
                </div>
                <a
                  href={item.actionHref}
                  className="shrink-0 text-sm font-medium text-primary hover:underline"
                >
                  {item.actionLabel}
                </a>
              </li>
            ))}
          </ul>
        )}
        {overflowCount > 0 ? (
          <Link
            href={`/w/${workspaceSlug}/notifications`}
            className="mt-2 block text-sm text-muted-foreground hover:text-foreground"
          >
            {overflowCount} more in inbox &rarr;
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
