import { SignInForm } from "@/components/auth/sign-in-form";

// Server Component shell (primary content server-rendered, AS-155); the
// interactive magic-link form is the sole Client Component boundary.
export default function SignInPage() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a magic link to sign in.
          </p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
