"use client";

// Smallest possible client boundary (tech-decisions.md convention): the
// members page (Server Component) fetches and renders everything else;
// this is only the interactive invite form, paired with the already-
// implemented F015 `inviteMember` Server Action per this feature's spec
// ("you may add a simple invite form here too since F015's action already
// exists and it's natural UI to pair with").
//
// `inviteMember(workspaceId, email)` takes plain arguments rather than the
// `(prevState, formData)` shape `useActionState` expects, so this wraps it
// manually with `useState` + `useTransition` instead of reusing the
// sign-in form's `useActionState` pattern.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { inviteMember } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InviteRole = "admin" | "member" | "viewer" | "guest" | "client";

export interface InviteableProject {
  id: string;
  name: string;
}

// F134 (AS-220): "guest" is now an invitable role. A guest invite is
// additionally scoped to one project at invite time — the project select
// below only renders once "Guest" is chosen, and is required before
// submit for that role only (a guest invite with no project would create
// a guest who can see nothing, which is a confusing dead end for the
// person sending the invite, even though the server itself treats it as
// merely a valid-but-useless state rather than a hard error — see
// lib/validation/workspaces.ts).
export function InviteMemberForm({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  projects: InviteableProject[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    // C8: a client, like a guest, is scoped entirely by project. Inviting
    // one with no project produces an account whose portal is empty — a
    // dead end that reads as a broken invite rather than a permission
    // decision, which is why both roles require the choice up front.
    const needsProject = role === "guest" || role === "client";

    if (needsProject && !projectId) {
      const message =
        role === "client"
          ? "Choose the project this client should see."
          : "Choose a project to scope this guest to.";
      setError(message);
      toast.error(message);
      return;
    }

    startTransition(async () => {
      const result = await inviteMember(
        workspaceId,
        email,
        role,
        needsProject && projectId ? projectId : undefined,
      );
      if (result.ok) {
        toast.success(
          result.emailSent
            ? `Invite sent to ${result.invitedEmail}.`
            : `Invite recorded for ${result.invitedEmail} — send them the sign-in link manually.`,
        );
        setEmail("");
        setRole("member");
        setProjectId(null);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3"
    >
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="invite-email">Invite by email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          placeholder="teammate@example.com"
          required
          disabled={isPending}
          value={email}
          onChange={(changeEvent) => setEmail(changeEvent.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-email-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            if (
              value !== "admin" &&
              value !== "member" &&
              value !== "viewer" &&
              value !== "guest" &&
              value !== "client"
            ) {
              return;
            }
            setRole(value);
            if (value !== "guest" && value !== "client") {
              setProjectId(null);
            }
          }}
          disabled={isPending}
        >
          <SelectTrigger id="invite-role" size="sm" className="w-28">
            <SelectValue>
              {(value: string) =>
                value === "client"
                  ? "Client"
                  : value === "guest"
                    ? "Guest"
                    : value === "viewer"
                      ? "Viewer"
                      : value === "admin"
                        ? "Admin"
                        : "Member"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="guest">Guest</SelectItem>
            <SelectItem value="client">Client</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(role === "guest" || role === "client") && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-project">Project</Label>
          <Select
            value={projectId ?? undefined}
            onValueChange={(value) => setProjectId(value)}
            disabled={isPending}
          >
            <SelectTrigger id="invite-project" size="sm" className="w-40">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sending...
          </>
        ) : (
          "Send invite"
        )}
      </Button>
      {error && (
        <p
          id="invite-email-error"
          role="alert"
          className="text-sm text-destructive sm:basis-full"
        >
          {error}
        </p>
      )}
    </form>
  );
}
