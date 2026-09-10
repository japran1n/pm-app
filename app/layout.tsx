import type { Metadata } from "next";
import { Inter, Source_Code_Pro } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Supabase design system migration (F004): Inter Variable without the
// opsz axis (Supabase's Inter-tuned type scale doesn't rely on optical
// sizing). Source Code Pro replaces IBM Plex Mono for link-text / tag-text.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
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
      className={`${inter.variable} ${sourceCodePro.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='light'){d.classList.remove('dark');d.removeAttribute('data-theme')}else{d.classList.add('dark');d.setAttribute('data-theme','dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="dark"
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
