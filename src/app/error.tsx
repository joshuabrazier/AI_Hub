"use client";

import { useEffect } from "react";

import { AppErrorPanel } from "@/features/layout/app-error-panel";

// -------------------------------------------------------------------
// The route error boundary.
//
// Catches a throw from anywhere below the root layout - a page, a nested
// layout, a Server Component, or a Server Action invoked from a form. It
// CANNOT catch a failure in the root layout itself; that is what
// global-error.tsx is for, and the two exist as a pair for that reason.
//
// A boundary must be a Client Component: it holds the reset handle and it
// renders after hydration, on the client, where the failure surfaced.
// -------------------------------------------------------------------
export default function AppError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Logged so a failure that a person recovers from by reloading still
    // leaves a trace. Without this the only record is whatever the server
    // wrote, which for a stale Server Action is a rejection with no context
    // about who hit it or on which screen.
    //
    // The MESSAGE is only useful in development - in production Next masks it
    // and the digest is the link to the server-side log line.
    console.error("Route error boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return <AppErrorPanel digest={error.digest} />;
}
