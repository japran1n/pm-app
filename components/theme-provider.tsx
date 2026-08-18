"use client";

// F125 (AS-211, AS-212, AS-213): thin wrapper around next-themes'
// ThemeProvider. next-themes (already an installed, previously-unused
// dependency per tech-decisions.md) owns:
//   - persisting the chosen theme to localStorage (AS-212's "persists
//     across reload and new tabs" — localStorage is shared across tabs of
//     the same origin, unlike a cookie-only or in-memory approach)
//   - injecting a blocking inline script into the server-rendered HTML,
//     synchronously before hydration, that reads that stored value and
//     sets the `dark` class (or none) on <html> before first paint
//     (AS-213 — see app/layout.tsx's `suppressHydrationWarning` on <html>,
//     required because that script mutates the element's class/style
//     attributes after the server render).
//
// Wrapped in its own file (rather than importing next-themes directly in
// the Server Component layout) only because next-themes' ThemeProvider is
// itself a Client Component and app/layout.tsx must stay import-clean for
// the "use client" boundary to be obvious at a glance — the same pattern
// already used by components/ui/sonner.tsx for the same library.
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
