import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import AppShell from "@/features/layout/app-shell";
import { BRAND } from "@/lib/brand";

// Inter carries running text.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// IBM Plex Sans sets headings. Drawn for IBM, so its engineering heritage
// suits a data product, and it is distinctive without dating quickly.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Plex Mono is the utility face: eyebrows, labels, and any figure that lines
// up in a column. Tabular by nature, which is why table numerics use it.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Source Serif carries the assistant's replies, and nothing else.
//
// A chat reply is the one place in this product where somebody READS rather
// than scans - paragraphs, at length, in sequence. A serif is measurably
// easier to read that way, and it also does a quieter job: it makes the
// model's half of the conversation look unmistakably different from the
// interface around it, without a label or a badge saying so.
//
// Deliberately NOT applied to figures, tables, labels or anything in the
// timesheet screens. Those are scanned, not read, and the sans faces above
// are chosen for that.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  icons: {
    icon: "/logo.png",
    // iOS "Add to Home Screen" uses this (not the manifest) for the icon.
    apple: "/logo.png",
  },
  title: BRAND.name,
  description: BRAND.description,
  // Standalone (installed) behaviour on iOS, and the home-screen label.
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexSans.variable} ${plexMono.variable} ${sourceSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>

        <ThemeProvider>
          <TooltipProvider>
            <AppShell>{children}</AppShell>

            <Toaster richColors toastOptions={{ className: "z-[9999]" }} />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
