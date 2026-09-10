"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

// Theme preference is stored in localStorage under the key "theme".
// Storage is origin-scoped (not shared across users or sessions).
// Server-rendered HTML always uses the defaultTheme to avoid hydration mismatch;
// the no-flash script in layout.tsx reads localStorage before React hydrates
// to prevent visible theme flash.
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
