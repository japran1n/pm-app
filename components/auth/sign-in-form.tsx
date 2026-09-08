"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";

import { signInWithMagicLink, type SignInResult } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignInResult | null = null;

export function SignInForm() {
  const [state, formAction, isPending] = useActionState(
    signInWithMagicLink,
    initialState,
  );

  // Success state (AS-002): confirm the email was sent instead of
  // re-rendering the form.
  if (state?.ok) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 p-6 text-center">
        <Mail className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-mini font-medium">Check your email</p>
        <p className="text-mini text-muted-foreground">
          We sent a sign-in link. It expires soon and can only be used once.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={isPending}
          aria-invalid={state?.ok === false}
          aria-describedby={state?.ok === false ? "sign-in-error" : undefined}
        />
      </div>

      {state?.ok === false && (
        <p id="sign-in-error" role="alert" className="text-mini text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sending link...
          </>
        ) : (
          "Send magic link"
        )}
      </Button>
    </form>
  );
}
