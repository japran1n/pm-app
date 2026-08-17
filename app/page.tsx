import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="text-2xl font-semibold tracking-tight">pm-app</span>
        <p className="text-sm text-muted-foreground">
          Project management, kept simple.
        </p>
      </div>
      <Button render={<Link href="/sign-in">Sign in</Link>} />
    </div>
  );
}
