import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-1 flex-col items-center justify-center gap-8 px-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-6 w-auto text-foreground" />
        <h1 className="max-w-md text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Project management, kept simple.
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Plan, track, and ship work with your team — without the clutter.
        </p>
      </div>
      <Button size="lg" nativeButton={false} render={<Link href="/sign-in">Sign in</Link>} />
    </div>
  );
}
