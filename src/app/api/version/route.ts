import { getBuildId } from "@/features/layout/build-id";

// -------------------------------------------------------------------
// Which build is serving this app right now.
//
// Polled by every open tab so it can notice that it has outlived the build
// it was served by, and reload before somebody presses a button that
// silently does nothing. See deployment-watch.ts for the rule.
//
// Where the id comes from, and why it is that one rather than a version
// string or a timestamp, is in `build-id.ts`. The root layout reads the same
// function, so the id stamped into a tab's HTML and the id this hands back
// are the same value read the same way.
//
// -------------------------------------------------------------------
// NO AUTHENTICATION, deliberately. A build id is not a secret - it is a
// random string identifying a deployment, it appears in the URL of every
// static asset the browser has already fetched, and the sign-in page needs
// this to work as much as any other. Gating it would only mean a signed-out
// tab could never notice it was stale.
// -------------------------------------------------------------------

// Stated rather than inferred. Route handlers are dynamic by default in this
// version of Next, but "which build is running" answered from a build-time
// snapshot is the one answer that must never be possible.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    // Unknown when the build cannot be determined - `next dev`, or a read
    // that failed. Not a reason to fail the request: the client treats it as
    // "no information" rather than as a change.
    { buildId: await getBuildId() },
    {
      // Never cached anywhere. A cached answer to "which build is running"
      // is the one answer that is certainly wrong after a deploy, and this
      // is the thing that notices deploys.
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
