import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Good Guys 3.0 design system (Figma "STYLE GUIDE" pages).
// The design specifies PP Neue Montreal (Book/400) for display + body and
// IBM Plex Mono (400) for link-text / tag-text. PP Neue Montreal is a
// commercial face with no files in this repo, so Geist stands in for it:
// same geometric-grotesque character, 400 as the working weight. To swap in
// the licensed face later, replace this one declaration with a
// next/font/local pointing at the .woff2 files — nothing else changes,
// because every consumer reads --font-sans.
const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "pm-app",
  description: "pm-app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // F125 (AS-213): suppressHydrationWarning is required on <html>
    // because next-themes' ThemeProvider renders a blocking inline script
    // (before children paint) that sets the `dark` class / `color-scheme`
    // style on this exact element from localStorage, before React
    // hydrates — that's what prevents a flash of the wrong theme. Without
    // this prop, React would log a hydration-mismatch warning for an
    // attribute change it didn't itself cause. Scoped to this one element
    // only, not the whole tree.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
