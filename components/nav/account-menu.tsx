"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import { LogOut, Loader2, MoreHorizontal, Settings, Sun, Moon, UserRound } from "lucide-react";

import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
import { signOut } from "@/lib/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// F002 (SB-012, SB-013, SB-014, SB-015, SB-009): the sidebar footer's
// avatar row is now the single entry point for account-level actions —
// previously this row was just a plain Link to the profile page, with a
// standalone <ThemeToggle/> living in the header row above and a
// standalone <SignOutButton/> living below it (both now removed, see
// app-sidebar.tsx). Reuses the same DropdownMenu primitive as every other
// menu in this app (base-ui Menu wrapper) rather than introducing a new
// popover pattern.
//
// Theme toggle mechanism is identical to components/ui/theme-toggle.tsx
// (same useTheme() hook from next-themes, same "flip light<->dark"
// behaviour) -- that file is left untouched/read-only per this feature's
// own "Files to touch" list; this menu item just calls the same hook
// directly instead of rendering that component's own <Button> trigger,
// since it needs to be a DropdownMenuItem here, not a standalone button.
export function AccountMenu({
  workspaceSlug,
  currentUser,
  canManageWorkspace,
  onNavigate,
}: {
  workspaceSlug: string;
  currentUser: UserAvatarPerson;
  canManageWorkspace: boolean;
  onNavigate?: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
    });
  }

  function handleThemeToggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  const isDark = theme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className={cn(
              // F265 (AS-518): same max-md:min-h-11 touch-target
              // convention as every other footer/nav row -- this trigger
              // is shared between the desktop <aside> and the mobile
              // Sheet.
              "flex min-h-9 w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-sm transition-colors max-md:min-h-11 text-muted-foreground hover:bg-accent",
            )}
          >
            <UserAvatar person={currentUser} size="sm" />
            <span className="min-w-0 flex-1 truncate text-left">
              {personLabel(currentUser)}
            </span>
            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem
          render={<Link href={`/w/${workspaceSlug}/settings/profile`} onClick={onNavigate} />}
        >
          <UserRound className="size-4" aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        {canManageWorkspace && (
          <DropdownMenuItem
            render={<Link href={`/w/${workspaceSlug}/settings`} onClick={onNavigate} />}
          >
            <Settings className="size-4" aria-hidden="true" />
            Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleThemeToggle}>
          {isDark ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : (
            <Moon className="size-4" aria-hidden="true" />
          )}
          Theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending}
          onClick={handleSignOut}
          variant="destructive"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="size-4" aria-hidden="true" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
