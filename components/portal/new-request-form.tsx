"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import {
  createClientRequest,
  type ClientRequestResult,
} from "@/lib/actions/client-requests";
import type { PortalProjectOption } from "@/lib/queries/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: ClientRequestResult | null = null;

export function NewRequestForm({
  projects,
}: {
  projects: PortalProjectOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    createClientRequest,
    initialState,
  );

  // Clearing the form after a successful submit matters here: leaving the
  // last request's text in the fields is the most common way to file the
  // same thing twice. Done by remounting on the new request's id rather
  // than by calling form.reset() through a ref — a ref read during render
  // is both a lint error and a real hazard, and the id changes exactly
  // once per successful submit, which is precisely when the form should
  // start over.
  const formKey = state?.ok ? state.data.requestId : "new";

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        You will be able to file requests once a project has been shared with
        you.
      </div>
    );
  }

  return (
    <form
      key={formKey}
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <h2 className="font-medium">New request</h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor="request-project">Project</Label>
        {/* A plain select rather than the app's Select primitive: this form
            posts as a real HTML form via useActionState, so the value has
            to be in the FormData without a hidden-input bridge. */}
        <select
          id="request-project"
          name="projectId"
          required
          disabled={isPending}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="request-title">What do you need?</Label>
        <Input
          id="request-title"
          name="title"
          required
          maxLength={200}
          placeholder="Add a testimonials section to the homepage"
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="request-body">Details (optional)</Label>
        <Textarea
          id="request-body"
          name="body"
          rows={3}
          maxLength={5000}
          placeholder="Anything that helps the team scope it."
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="request-desired-by">Needed by (optional)</Label>
        <Input
          id="request-desired-by"
          name="desiredBy"
          type="date"
          disabled={isPending}
          className="w-fit"
        />
      </div>

      {state?.ok === false && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          Sent. You will see it below with whatever the team decides.
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sending...
          </>
        ) : (
          "Send request"
        )}
      </Button>
    </form>
  );
}
