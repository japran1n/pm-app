import { SignInForm } from "@/components/auth/sign-in-form";

// Server Component shell (primary content server-rendered, AS-155); the
// interactive magic-link form is the sole Client Component boundary.
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
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a magic link to sign in.
          </p>
        </div>
        {linkExpired && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            This link has expired or was already used. Enter your email
            below to request a new one.
          </p>
        )}
        <SignInForm />
      </div>
    </main>
  );
}
