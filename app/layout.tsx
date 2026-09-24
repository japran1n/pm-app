import type { Metadata } from "next";
import { headers } from "next/headers";
import { DM_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});


export const metadata: Metadata = {
  title: "Goodguys Studio",
  description: "Goodguys Studio is your team's workspace for projects, tasks, and clients.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // SEC-HTTP-07: per-request CSP nonce minted by proxy.ts and forwarded on
  // the request. Under `script-src 'nonce-…' 'strict-dynamic'` every
  // parser-inserted script needs it — Next nonces its own scripts from the
  // request's CSP header; this layout's own scripts are nonced here.
  // Reading headers() makes every route dynamic, which a per-request nonce
  // requires anyway (a prerendered page cannot carry one).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${dmSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* No-FOUC theme bootstrap (audit NX-002/AS-148): an external
            blocking script instead of an inline raw-HTML one —
            CSP-compatible, and keeps app/ free of raw-HTML sinks. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run before first paint */}
        <script src="/theme-init.js" nonce={nonce} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
