import { PasswordSignInForm } from "@/components/auth/password-sign-in-form";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Logo } from "@/components/brand/logo";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

// Server Component shell (primary content server-rendered, AS-155); the
// interactive forms are the only Client Component boundaries.
//
// Two sign-in paths are offered side by side: the magic link (the
// production path, AS-002) and email-or-username + password (added so the
// app can be signed into repeatedly during testing without an inbox and
// without hitting Supabase's magic-link send rate limit). Password is the
// default tab because it is the one that works everywhere; the magic-link
// form and its behaviour are unchanged.
//
// Both panels are `keepMounted`: Base UI renders only the active panel by
// default, which would leave whichever form is not selected out of the
// server-rendered HTML entirely. AS-004 requires the magic-link form to be
// present on this page, and both forms should work before hydration, so
// both are always in the markup and the inactive one is hidden by Base UI.
//
// AS-004: if the magic-link callback route (app/(auth)/auth/callback/
// route.ts) failed to exchange/validate the code — expired or already-used
// link — it redirects here with `?error=auth_failed`. We read that here
// (Next.js 16: searchParams is async and must be awaited) and pass it down
// so the error renders inline, right above the same sign-in form the user
// needs to request a new link. No separate dead-end error page.
type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error } = await searchParams;
  const linkExpired = error === "auth_failed";

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-10 p-6">
      <Logo className="h-5 w-auto text-foreground" />

      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="title-2 font-semibold tracking-tight">Sign in</h1>
          <p className="text-mini text-muted-foreground">
            Use your password, or have a one-time link emailed to you.
          </p>
        </div>

        {linkExpired && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-mini text-destructive"
          >
            This link has expired or was already used. Enter your email
            below to request a new one.
          </p>
        )}

        <Tabs defaultValue={linkExpired ? "magic-link" : "password"}>
          <TabsList className="w-full">
            <TabsTrigger value="password" className="flex-1">
              Password
            </TabsTrigger>
            <TabsTrigger value="magic-link" className="flex-1">
              Magic link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="password" className="pt-4" keepMounted>
            <PasswordSignInForm />
          </TabsContent>

          <TabsContent value="magic-link" className="pt-4" keepMounted>
            <SignInForm />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
