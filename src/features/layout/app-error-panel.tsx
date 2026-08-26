"use client";

import { RefreshCw } from "lucide-react";

import { BRAND } from "@/lib/brand";

// -------------------------------------------------------------------
// What somebody sees when a page or an action fails.
//
// WHY THIS EXISTS AT ALL, because the absence was the bug rather than a
// missing nicety.
//
// Next gives every Server Action an id generated at BUILD TIME, and the
// browser holds that id in the JavaScript it downloaded. Deploy a new build
// and the ids change - so a tab loaded from the old build calls an action the
// new server has never heard of, and the request is rejected with "Failed to
// find Server Action". Nothing is corrupted: the action never runs, so there
// is no partial write. It fails closed, which is the right way round.
//
// What it did instead was fail SILENTLY. With no error boundary anywhere in
// the app, the person pressing Save got Next's default handling and nothing
// actionable - so they pressed it again, and again. The signature in the logs
// is several identical failures within a few seconds.
//
// It is not a deploy-time race either. A tab, or an installed app on a home
// screen, can be days and several builds behind. Every form submitted from it
// fails until the page happens to be reloaded.
//
// THREE DELIBERATE CALLS BELOW:
//
//   1. The wording does not name version skew. In production Next MASKS the
//      server error message and hands the boundary a digest instead of the
//      text, so there is no reliable way to tell a stale action from a
//      database fault. Guessing wrong in front of somebody is worse than
//      saying less. It says what to DO, which is the same either way.
//
//   2. A FULL RELOAD, not reset() and not router.refresh(). The whole point
//      is to fetch the new build; re-running the render against the same
//      stale JavaScript changes nothing.
//
//   3. ONE BUTTON. A "Try again" beside it would be the obvious thing to add
//      and cannot fix the very case this was built for - it would re-run the
//      failed action with the same dead id, look like a second failure, and
//      teach people the app is broken rather than stale.
//
// THIS DOES NOT PREVENT THE SKEW. It makes the failure legible and
// recoverable. Prevention would be service-worker update detection; this app
// registers its worker only when somebody turns on push notifications, so it
// would help almost nobody today. Worth revisiting if that changes.
// -------------------------------------------------------------------
export function AppErrorPanel({ digest }: { digest?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <RefreshCw size={22} aria-hidden="true" />
        </span>

        <h1 className="mt-5 font-heading text-2xl font-bold text-foreground">Something went wrong</h1>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Reloading usually fixes it, especially if this page has been open a while and {BRAND.name} has been
          updated since.
        </p>

        <button
          type="button"
          // window.location.reload, not the boundary's reset(): the point is
          // to fetch the current build, which a re-render cannot do.
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Reload the page
        </button>

        {/* The digest is all production gives us, and it is what ties this
            screen to a line in the server log. Shown so somebody reporting
            the problem has something to quote. */}
        {digest && (
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            Reference: <span className="select-all">{digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
