"use client";

import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SwitcherWorkspace = {
  id: string;
  name: string;
  slug: string;
};

// Client Component (smallest possible client boundary per tech-decisions.md
// — the parent layout server-fetches the data, this component is just the
// interactive dropdown). AS-012: lists every workspace the user is an
// active member of. AS-013: each entry links to `/w/[slug]`, so selecting
// one changes the URL and (because the destination is a Server Component
// route) reloads workspace-scoped data server-side.
export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
}: {
  workspaces: SwitcherWorkspace[];
  currentWorkspaceId: string;
}) {
  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  // Empty state: should be unreachable (the layout guarantees the active
  // workspace is included), but handled explicitly rather than assuming.
  if (workspaces.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">No workspaces</span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="max-w-56 gap-1.5">
            <span className="truncate">{current?.name ?? "Select workspace"}</span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            render={<Link href={`/w/${workspace.slug}`} />}
            className="justify-between gap-2"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.id === currentWorkspaceId ? (
              <Check className="text-muted-foreground" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
