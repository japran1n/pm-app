"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import {
  LogOut,
  Loader2,
  MoreHorizontal,
  Settings,
  Sun,
  Moon,
  UserRound,
  Archive,
  LayoutTemplate,
  Trash2,
  HelpCircle,
  Eye,
} from "lucide-react";

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
  isGuest = false,
  hasClient = false,
  onNavigate,
}: {
  workspaceSlug: string;
  currentUser: UserAvatarPerson;
  canManageWorkspace: boolean;
  /** F003 (SB-016, SB-017, SB-006): gates Templates/Archive/Trash the same
   * way app-sidebar.tsx's own `guestExcluded` set used to when these items
   * still lived there -- a guest never sees an entry point to any of the
   * three. "How this works" is intentionally NOT gated here, same
   * reasoning as its old sidebar doc comment: a guest benefits from the
   * orientation page at least as much as a full member, and it has no
   * workspace data of its own to leak. Default `false` keeps every
   * existing caller/test that predates this prop rendering the full menu
   * instead of crashing. */
  isGuest?: boolean;
  /** F004 (SB-019, SB-006): gates "Preview as client" the same way the
   * sidebar's own `team` array did — only shown when the workspace has a
   * client AND the current user can manage the workspace
   * (owner/admin). Default `false` keeps every existing caller/test that
   * predates this prop rendering the menu without the item instead of
   * crashing. */
  hasClient?: boolean;
  onNavigate?: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
    });
  }

  function handleThemeToggle() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  const isDark = resolvedTheme === "dark";

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
        {/* F003 (SB-016, SB-017, SB-006): Templates/Archive/Trash/Help,
            formerly the sidebar's own "Other" group (see app-sidebar.tsx's
            own doc comment) -- moved here verbatim with the same role
            gates they had there. */}
        {!isGuest && (
          <DropdownMenuItem
            render={<Link href={`/w/${workspaceSlug}/templates`} onClick={onNavigate} />}
          >
            <LayoutTemplate className="size-4" aria-hidden="true" />
            Templates
          </DropdownMenuItem>
        )}
        {!isGuest && (
          <DropdownMenuItem
            render={<Link href={`/w/${workspaceSlug}/archive`} onClick={onNavigate} />}
          >
            <Archive className="size-4" aria-hidden="true" />
            Archive
          </DropdownMenuItem>
        )}
        {!isGuest && (
          <DropdownMenuItem
            render={<Link href={`/w/${workspaceSlug}/trash`} onClick={onNavigate} />}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Trash
          </DropdownMenuItem>
        )}
        {/* Not guest-gated -- see the `isGuest` prop's own doc comment. */}
        <DropdownMenuItem
          render={<Link href={`/w/${workspaceSlug}/help`} onClick={onNavigate} />}
        >
          <HelpCircle className="size-4" aria-hidden="true" />
          How this works
        </DropdownMenuItem>
        {/* F004 (SB-019, SB-006): "Preview as client" — mirrors the exact
            condition used in app-sidebar.tsx's own `team` array before this
            feature: hasClient AND canManageWorkspace. The destination page
            (preview-as-client/page.tsx) hard-gates to owner/admin itself, so
            a member/viewer/guest would only bounce; the hasClient guard
            prevents a meaningless link for workspaces that have no portal. */}
        {hasClient && canManageWorkspace && (
          <DropdownMenuItem
            render={<Link href={`/w/${workspaceSlug}/preview-as-client`} onClick={onNavigate} />}
          >
            <Eye className="size-4" aria-hidden="true" />
            Preview as client
          </DropdownMenuItem>
        )}
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
