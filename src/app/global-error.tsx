"use client";

import { useEffect } from "react";

import { AppErrorPanel } from "@/features/layout/app-error-panel";

// The root layout is what normally loads this, and this file REPLACES the
// root layout when it renders - so the stylesheet has to be imported here too
// or the fallback arrives unstyled at exactly the worst moment.
import "./globals.css";

// -------------------------------------------------------------------
// The root error boundary.
//
// Only for a failure in the ROOT LAYOUT itself - the providers, the shell,
// the font loading. error.tsx sits below the root layout and therefore cannot
// catch anything that happens while the root layout is rendering.
//
// It replaces the whole document, which is why it renders its own <html> and
// <body>: there is no layout above it to supply them.
//
// Rare, and correspondingly easy to leave missing. The failure mode without
// it is a blank page with a stack trace in the console, on the one path where
// the app has no chrome left to explain itself.
//
// No theme class on <html> deliberately. next-themes lives in the layout that
// just failed, so the light palette is the honest default rather than reading
// a preference the provider is not there to apply.
// -------------------------------------------------------------------
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global error boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <AppErrorPanel digest={error.digest} />
      </body>
    </html>
  );
}
