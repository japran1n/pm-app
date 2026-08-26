"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// UX-23: the portal's top nav rendered "Projects" and "Requests" with the
// exact same style on every page — both `text-muted-foreground` — so a
// client had no way to tell which section they were in. The workspace
// sidebar (components/nav/app-sidebar.tsx) already solves this with
// `aria-current="page"` off `usePathname`; this is the same pattern, just
// needing its own small Client Component since the portal layout around it
// is a Server Component.
export function PortalNav({ workspaceSlug }: { workspaceSlug: string }) {
  const pathname = usePathname();

  const items = [
    { href: `/portal/${workspaceSlug}`, label: "Projects", exact: true },
    { href: `/portal/${workspaceSlug}/requests`, label: "Requests" },
  ];

  return (
    <nav className="flex items-center gap-1">
      {items.map(({ href, label, exact }) => {
        const isActive = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "hover-surface rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
