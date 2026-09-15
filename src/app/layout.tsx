import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import AppShell from "@/features/layout/app-shell";
import { getBuildId } from "@/features/layout/build-id";
import { DeploymentWatcher } from "@/features/layout/deployment-watcher";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Which build rendered THIS document. Read here rather than discovered by
  // the client, for the reason in `deployment-watcher.tsx`: a tab that adopts
  // whatever its first poll reports is permanently exempt if it happened to
  // load while a deployment was rolling.
  const servedBy = await getBuildId();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>

        {/* Renders nothing. Mounted HERE rather than inside AppShell because
            AppShell returns bare children on the chromeless routes - the
            landing page and sign-in - and a tab left open on sign-in over a
            deploy is stale in exactly the same way as any other. */}
        <DeploymentWatcher servedBy={servedBy} />

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
