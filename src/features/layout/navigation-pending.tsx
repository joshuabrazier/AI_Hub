"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { useSidebar } from "./sidebar-context";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Navigation pending state
// App Router navigations wait for the server to render the destination
// before swapping it in, with no feedback in between. We surface that wait
// with a centered spinner over the content area (the nav chrome stays put).
//
// useLinkStatus reports the pending state of the <Link> it sits inside, but a
// link can unmount mid-navigation (e.g. the mobile menu closes on tap), which
// would drop the signal. So a per-link reporter latches "pending" into this
// context, recording the route it started from, and we clear it once the route
// actually changes. That keeps the spinner alive for the whole transition on
// every device.
// -------------------------------------------------------------------
type NavigationPendingContextValue = {
  pending: boolean;
  start: () => void;
};

const NavigationPendingContext = createContext<NavigationPendingContextValue | null>(null);

type PendingState = { active: boolean; from: string | null };

export function NavigationPendingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingState>({ active: false, from: null });

  // Navigation finished once the route changes away from where it started.
  // Adjusting state during render (not inside an effect) so it settles in the
  // same pass the new route arrives.
  if (pending.active && pending.from !== pathname) {
    setPending({ active: false, from: null });
  }

  const start = useCallback(() => {
    setPending((previous) => (previous.active ? previous : { active: true, from: pathname }));
  }, [pathname]);

  // Safety net so an aborted navigation (route never changes) can't leave the
  // spinner stuck. setState only runs inside the timer, never synchronously.
  useEffect(() => {
    if (!pending.active) return;
    const timeout = setTimeout(() => setPending({ active: false, from: null }), 10000);
    return () => clearTimeout(timeout);
  }, [pending.active]);

  const value = useMemo<NavigationPendingContextValue>(
    () => ({ pending: pending.active, start }),
    [pending.active, start],
  );

  return <NavigationPendingContext.Provider value={value}>{children}</NavigationPendingContext.Provider>;
}

function useNavigationPending() {
  const context = useContext(NavigationPendingContext);
  if (!context) throw new Error("useNavigationPending must be used within a NavigationPendingProvider");
  return context;
}

// Drop this inside a <Link> to report when that link is navigating. Renders
// nothing itself.
export function NavigationPendingReporter() {
  const { pending } = useLinkStatus();
  const { start } = useNavigationPending();

  useEffect(() => {
    if (pending) start();
  }, [pending, start]);

  return null;
}

// How long a navigation must be in flight before the spinner appears. Quick
// page changes finish first and never flash it; raise this if fast pages still
// flash, lower it to show the spinner sooner on genuinely slow ones.
const SPINNER_DELAY_MS = 400;

// The spinner itself. Covers only the content area (offset below the top bar
// and to the right of the sidebar), so the nav chrome stays visible. It only
// appears once a navigation has been pending for SPINNER_DELAY_MS.
export function NavigationPendingOverlay() {
  const { pending } = useNavigationPending();
  const { collapsed } = useSidebar();
  const [visible, setVisible] = useState(false);

  // Hide immediately (during render) when no longer pending.
  if (!pending && visible) {
    setVisible(false);
  }

  // Reveal only if the navigation is still going after a short delay. setState
  // runs inside the timer, never synchronously in the effect body.
  useEffect(() => {
    if (!pending) return;
    const timeout = setTimeout(() => setVisible(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [pending]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 bottom-0 top-20 z-40 flex items-center justify-center bg-background",
        collapsed ? "md:left-16" : "md:left-64",
      )}
    >
      <div className="h-14 w-14 animate-spin rounded-full border-6 border-primary border-t-transparent" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
