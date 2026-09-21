"use client";

// F024 (missions/20260903-portal, AS-052): the picker for
// /w/[workspaceSlug]/preview-as-client. Calls `startClientPreview`
// (lib/actions/portal-preview.ts) and, on success, navigates the browser
// straight into the real portal route it returns -- the SAME route tree
// a real client uses, now rendering with that client's own minted
// session (see that action's own file-header comment for the mechanism).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, FolderOpen, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { startClientPreview } from "@/lib/actions/portal-preview";
import type { PreviewableClient } from "@/lib/queries/portal-preview";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";

export function ClientPreviewForm({
  workspaceId,
  workspaceSlug,
  clients,
  projects,
  initialProjectId,
  initialTaskId,
}: {
  workspaceId: string;
  workspaceSlug: string;
  clients: PreviewableClient[];
  projects: { id: string; name: string }[];
  initialProjectId?: string;
  initialTaskId?: string;
}) {
  const router = useRouter();
  const [clientUserId, setClientUserId] = useState<string | undefined>(
    clients[0]?.userId,
  );
  const selectedClient = clients.find((c) => c.userId === clientUserId);
  const [projectId, setProjectId] = useState<string | undefined>(
    initialProjectId,
  );
  const selectedProject = projects.find((p) => p.id === projectId);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!clientUserId) return;

    startTransition(async () => {
      const result = await startClientPreview({
        workspaceId,
        workspaceSlug,
        clientUserId,
        projectId,
        taskId: projectId === initialProjectId ? initialTaskId : undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      router.push(result.redirectTo);
    });
  }

  const clientLabel =
    selectedClient?.name ?? selectedClient?.email ?? "this client";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Client selector */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="preview-client">Client</Label>
          <Select
            value={clientUserId ?? undefined}
            onValueChange={(v) => setClientUserId(v || undefined)}
          >
            <SelectTrigger id="preview-client" aria-label="Client" className="h-auto py-2">
              <SelectValue placeholder="Choose a client">
                {selectedClient && (
                  <span className="flex items-center gap-2.5">
                    <UserAvatar
                      person={{
                        id: selectedClient.userId,
                        name: selectedClient.name,
                        email: selectedClient.email,
                        avatarUrl: selectedClient.avatarUrl,
                      }}
                      size="sm"
                    />
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-sm font-medium">
                        {selectedClient.name ?? selectedClient.email ?? selectedClient.userId}
                      </span>
                      {selectedClient.name && selectedClient.email && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {selectedClient.email}
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.userId} value={client.userId}>
                  <span className="flex items-center gap-2.5">
                    <UserAvatar
                      person={{
                        id: client.userId,
                        name: client.name,
                        email: client.email,
                        avatarUrl: client.avatarUrl,
                      }}
                      size="sm"
                    />
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-sm font-medium">
                        {client.name ?? client.email ?? client.userId}
                      </span>
                      {client.name && client.email && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {client.email}
                        </span>
                      )}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project selector */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="preview-project">Project (optional)</Label>
          <Select
            value={projectId ?? "__none"}
            onValueChange={(v) =>
              setProjectId(!v || v === "__none" ? undefined : v)
            }
          >
            <SelectTrigger id="preview-project" aria-label="Project" className="h-auto py-2">
              <SelectValue>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-sm">
                    {selectedProject ? selectedProject.name : "Land on the project chooser"}
                  </span>
                  {selectedProject && (
                    <span className="text-xs text-muted-foreground">
                      Opens on project overview
                    </span>
                  )}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Land on the project chooser</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" disabled={!clientUserId || isPending}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Eye className="size-4" />
          )}
          View as {clientLabel}
        </Button>
      </form>

      {/* Sidebar */}
      <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
        {selectedClient ? (
          <>
            <div className="flex flex-col items-center gap-2 py-2">
              <UserAvatar
                person={{
                  id: selectedClient.userId,
                  name: selectedClient.name,
                  email: selectedClient.email,
                  avatarUrl: selectedClient.avatarUrl,
                }}
                size="lg"
              />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {selectedClient.name ?? selectedClient.email}
                </p>
                {selectedClient.name && selectedClient.email && (
                  <p className="font-mono text-xs text-muted-foreground">
                    {selectedClient.email}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                Permissions
              </p>
              <ul className="flex flex-col gap-1.5">
                {[
                  "View assigned projects",
                  "View tasks & updates",
                  "Comment on tasks",
                  "No billing or settings access",
                ].map((perm) => (
                  <li key={perm} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3 shrink-0 text-foreground/40" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>

            {selectedProject && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  Landing on
                </p>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                  <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs">{selectedProject.name}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-xs text-muted-foreground py-4">
            Select a client to see their identity and permissions.
          </p>
        )}
      </aside>
    </div>
  );
}
