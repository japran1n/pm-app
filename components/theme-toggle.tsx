"use client";

// F125 (AS-211): the visible light/dark/system toggle. Lives in the
// sidebar footer next to sign-out per the feature spec's Files list
// (components/nav/app-sidebar.tsx).
//
// Built on ToggleGroup (components/ui/toggle-group.tsx, added by F119)
// rather than a dropdown menu so all three states are visible and
// reachable at once, not hidden behind an extra click — a segmented
// control is the more literal reading of "a visible toggle offers light,
// dark, and system" (AS-211). Base UI's ToggleGroup is a `<div
// role="group">` of `<button>`s with roving tabindex, so left/right arrow
// keys move focus between the three options and Enter/Space presses the
// focused one — keyboard-operable with no extra wiring.
//
// Accessible name: the group itself carries `aria-label="Theme"` (the
// control's own name, read once), and each button additionally carries
// `aria-label="<Light|Dark|System> theme"` (the option's own name) plus a
// visible icon — matching the pattern components/ui/toggle-group.tsx's
// upstream examples use for icon-only toggle items.
import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes' own state initializer reads localStorage synchronously
  // during the client's first render (see node_modules/next-themes), so
  // `theme` can already be e.g. "dark" on the very first client render —
  // but the server had no localStorage to read and rendered with
  // `theme: undefined`. If this component's JSX used `theme` directly,
  // that would produce a real hydration mismatch (different `aria-
  // pressed` attributes between the server-rendered markup and what the
  // client computes while hydrating).
  //
  // `useSyncExternalStore` with a `getServerSnapshot` that differs from
  // `getSnapshot` is the React-documented way to read "is this the
  // client, post-hydration, yet" without that mismatch: React forces the
  // first client render to use `getServerSnapshot` (matching what the
  // server sent), then re-renders with the real client value right after
  // hydration commits — no `useEffect` + `setState` needed for this,
  // which is also what keeps this off the react-hooks
  // set-state-in-effect rule this repo lints with. This is a mismatch in
  // the *toggle control's own pressed state* only — it has no bearing on
  // AS-213, which is about the page's background/text colour and is
  // already resolved before this component ever mounts by the blocking
  // script next-themes injects (see components/theme-provider.tsx).
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const current: ThemeValue | undefined = isClient
    ? ((theme as ThemeValue | undefined) ?? "system")
    : undefined;

  return (
    <ToggleGroup
      aria-label="Theme"
      value={current ? [current] : []}
      onValueChange={(value) => {
        const next = value[0];
        if (next) setTheme(next);
      }}
      variant="outline"
      size="sm"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={`${label} theme`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
