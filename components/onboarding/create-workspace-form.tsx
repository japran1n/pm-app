"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import {
  createWorkspace,
  type CreateWorkspaceResult,
} from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: CreateWorkspaceResult | null = null;

export function CreateWorkspaceForm() {
  const [state, formAction, isPending] = useActionState(
    createWorkspace,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder="Acme Inc."
          required
          maxLength={80}
          disabled={isPending}
          aria-invalid={state?.ok === false}
          aria-describedby={state?.ok === false ? "workspace-name-error" : undefined}
        />
      </div>

      {state?.ok === false && (
        <p
          id="workspace-name-error"
          role="alert"
          className="text-mini text-destructive"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Creating...
          </>
        ) : (
          "Create workspace"
        )}
      </Button>
    </form>
  );
}
