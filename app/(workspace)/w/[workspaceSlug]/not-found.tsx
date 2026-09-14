import Link from "next/link";

// Audit NX-004: workspace-segment 404 — renders inside the workspace shell
// (sidebar/nav stay mounted), so a bad task key or project id doesn't blank
// the whole app.
export default function WorkspaceNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-base font-medium">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This item doesn&apos;t exist in this workspace, or you don&apos;t have
        access to it.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to home
      </Link>
    </div>
  );
}
