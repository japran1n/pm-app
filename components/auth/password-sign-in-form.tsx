"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import {
  signInWithPassword,
  type PasswordSignInResult,
} from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: PasswordSignInResult | null = null;

// Email-or-username + password sign-in. Deliberately a sibling of
// SignInForm rather than a mode inside it: the two flows share no state
// (one ends in a "check your email" panel, the other in a redirect), and
// keeping them separate means the magic-link path is untouched.
export function PasswordSignInForm() {
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="identifier">Email or username</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          placeholder="you@example.com"
          autoFocus
          required
          disabled={isPending}
          aria-invalid={state?.ok === false}
          aria-describedby={
            state?.ok === false ? "password-sign-in-error" : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          minLength={6}
          disabled={isPending}
          aria-invalid={state?.ok === false}
        />
      </div>

      {state?.ok === false && (
        <p
          id="password-sign-in-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Signing in...
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
