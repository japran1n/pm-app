"use client";

// F3 (docs/client-dashboard-features-plan.md): the bucket is private, so a
// file's URL is never persisted or embedded directly — same convention as
// components/task/attachment-list.tsx: a click requests a fresh signed URL
// (1-hour TTL, lib/actions/attachments.ts) and opens it, rather than
// rendering a permanent link that would outlive the signed URL anyway.

import { useTransition } from "react";
import Link from "next/link";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getAttachmentSignedUrl } from "@/lib/actions/attachments";
import type { PortalFile } from "@/lib/queries/portal";
import { formatDate } from "@/lib/format";

function FileRow({ file }: { file: PortalFile }) {
  const [isPending, startTransition] = useTransition();

  const handleOpen = () => {
    startTransition(async () => {
      const result = await getAttachmentSignedUrl(file.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        disabled={isPending}
        className="hover-surface flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {isPending ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <Download
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 truncate font-medium">
            {file.fileName}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {file.taskTitle} · <span className="font-mono">{formatDate(file.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

export function PortalFileList({
  workspaceSlug,
  files,
}: {
  workspaceSlug: string;
  files: PortalFile[];
}) {
  const byProject = new Map<
    string,
    { projectName: string; files: PortalFile[] }
  >();

  for (const file of files) {
    const entry = byProject.get(file.projectId);
    if (entry) {
      entry.files.push(file);
    } else {
      byProject.set(file.projectId, {
        projectName: file.projectName,
        files: [file],
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byProject.entries()].map(([projectId, group]) => (
        <div key={projectId} className="flex flex-col gap-2">
          <Link
            href={`/portal/${workspaceSlug}/p/${projectId}`}
            className="w-fit text-sm font-semibold tracking-tight hover:underline"
          >
            {group.projectName}
          </Link>
          <ul className="flex flex-col rounded-lg border border-border">
            {group.files.map((file) => (
              <FileRow key={file.id} file={file} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
