"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { RequestList } from "@/components/portal/request-list";
import type { PortalRequest } from "@/lib/queries/portal";

export function RequestsDrawer({
  requests,
  projectId,
}: {
  requests: PortalRequest[];
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const count = requests.length;

  return (
    <div className="border-t border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span>
          Your requests
          {count > 0 && (
            <span className="ml-1.5 tabular-nums text-xs">({count})</span>
          )}
        </span>
        <ChevronDown
          className={`size-4 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div className="max-h-72 overflow-y-auto px-4 pb-4">
          <RequestList requests={requests} projectId={projectId} />
        </div>
      )}
    </div>
  );
}
