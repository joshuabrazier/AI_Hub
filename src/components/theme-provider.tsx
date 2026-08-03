"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

import { isChromelessRoute } from "@/lib/routes";

// -------------------------------------------------------------------
// ThemeProvider
// Wraps next-themes so the authenticated portal can switch between
// light, dark and system themes (applied as a class on <html>, matching
// the `.dark` tokens in globals.css). Defaults to light.
//
// Public pages (landing, marketing, auth) are ALWAYS light - dark mode is
// a portal-only preference - so we force light there via the pathname.
// The user's saved theme is untouched and resumes in the portal.
// -------------------------------------------------------------------
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const forcedTheme = isChromelessRoute(pathname) ? "light" : undefined;

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      forcedTheme={forcedTheme}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
