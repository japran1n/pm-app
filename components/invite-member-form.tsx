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

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await inviteMember(workspaceId, email);
      if (result.ok) {
        toast.success(`Invite sent to ${result.invitedEmail}.`);
        setEmail("");
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3"
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
