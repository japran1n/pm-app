import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Linear design system migration (F002): Inter Variable stands in for
// Linear's proprietary "Inter Display" pairing — same geometric-humanist
// character, opsz axis enabled for optical sizing across the type scale.
// IBM Plex Mono is kept (Berkeley Mono declined) for link-text / tag-text.
const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Goodguys Studio",
  description: "Goodguys Studio is your team's workspace for projects, tasks, and clients.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
