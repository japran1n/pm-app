"use client";

// F024 (missions/20260903-portal, AS-052): the picker for
// /w/[workspaceSlug]/preview-as-client. Calls `startClientPreview`
// (lib/actions/portal-preview.ts) and, on success, navigates the browser
// straight into the real portal route it returns -- the SAME route tree
// a real client uses, now rendering with that client's own minted
// session (see that action's own file-header comment for the mechanism).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
  /** Pre-filled when opened via the "View as client" shortcut from a
   * task detail sheet or doc header -- see those components' own doc
   * comments. Undefined for the standalone/fallback route. */
  initialProjectId?: string;
  initialTaskId?: string;
}) {
  const router = useRouter();
  const [clientUserId, setClientUserId] = useState<string | undefined>(
    clients[0]?.userId,
  );
  const selectedClient = clients.find(
    (client) => client.userId === clientUserId,
  );
  const [projectId, setProjectId] = useState<string | undefined>(
    initialProjectId,
  );
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
        // A task deep-link only makes sense alongside the project it
        // belongs to -- dropped silently if the operator changed the
        // project selection away from the shortcut's original one.
        taskId: projectId === initialProjectId ? initialTaskId : undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      router.push(result.redirectTo);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="preview-client">Client</Label>
        <Select
          value={clientUserId ?? null}
          onValueChange={(value) => setClientUserId(value ?? undefined)}
        >
          <SelectTrigger id="preview-client" aria-label="Client">
            <SelectValue placeholder="Choose a client">
              {selectedClient ? (
                <span className="flex items-center gap-2">
                  <UserAvatar
                    person={{
                      id: selectedClient.userId,
                      name: selectedClient.name,
                      email: selectedClient.email,
                      avatarUrl: selectedClient.avatarUrl,
                    }}
                    size="sm"
                  />
                  {selectedClient.name ?? selectedClient.email ?? selectedClient.userId}
                </span>
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.userId} value={client.userId}>
                <span className="flex items-center gap-2">
                  <UserAvatar
                    person={{
                      id: client.userId,
                      name: client.name,
                      email: client.email,
                      avatarUrl: client.avatarUrl,
                    }}
                    size="sm"
                  />
                  {client.name ?? client.email ?? client.userId}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="preview-project">Project (optional)</Label>
        <Select
          value={projectId ?? "__none"}
          onValueChange={(value) =>
            setProjectId(!value || value === "__none" ? undefined : value)
          }
        >
          <SelectTrigger id="preview-project" aria-label="Project">
            <SelectValue placeholder="Land on the project chooser" />
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
        {isPending && <Loader2 className="size-4 animate-spin" />}
        View as this client
      </Button>
    </form>
  );
}
