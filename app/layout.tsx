import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
      className={`${inter.variable} h-full antialiased`}
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
