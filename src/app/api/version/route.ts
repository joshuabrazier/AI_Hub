import { readFile } from "node:fs/promises";
import path from "node:path";

import { UNKNOWN_BUILD_ID } from "@/features/layout/deployment-watch";

// -------------------------------------------------------------------
// Which build is serving this app right now.
//
// Polled by every open tab so it can notice that it has outlived the build
// it was served by, and reload before somebody presses a button that
// silently does nothing. See deployment-watch.ts for the rule.
//
// -------------------------------------------------------------------
// IT READS .next/BUILD_ID RATHER THAN AN ENVIRONMENT VARIABLE, and the
// reason is that the alternative can cause a reload loop.
//
// A value baked in through next.config's `env` is inlined into the client
// bundle at BUILD time but re-evaluated on the server at RUNTIME. Generate it
// from a timestamp or a fresh git call and the two disagree permanently -
// every poll reports a "new" build, every tab reloads, and the app is
// unusable until somebody closes it. BUILD_ID is written once by `next build`
// and does not change for the life of the deployment, which is exactly the
// property needed.
//
// It is also the RIGHT id rather than a proxy for one: Next.js derives the
// server action hashes from this same build, so a tab whose BUILD_ID differs
// is precisely a tab whose action ids the server will reject.
//
// -------------------------------------------------------------------
// NO AUTHENTICATION, deliberately. A build id is not a secret - it is a
// random string identifying a deployment, it appears in the URL of every
// static asset the browser has already fetched, and the sign-in page needs
// this to work as much as any other. Gating it would only mean a signed-out
// tab could never notice it was stale.
// -------------------------------------------------------------------

// Read once per process. The file cannot change while this server is running:
// a new build is a new deployment and therefore a new process.
let cached: string | null = null;

async function readBuildId(): Promise<string> {
  if (cached) return cached;

  try {
    // `process.cwd()` is the app root under both `next start` and the
    // standalone server, which places .next beside the server it runs.
    const raw = await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8");
    const buildId = raw.trim();

    cached = buildId.length > 0 ? buildId : UNKNOWN_BUILD_ID;
  } catch {
    // Development has no BUILD_ID, and a deployment that somehow cannot read
    // its own is not a reason to fail a request. Unknown is reported plainly
    // and the client treats it as "no information" rather than as a change.
    cached = UNKNOWN_BUILD_ID;
  }

  return cached;
}

export async function GET() {
  return Response.json(
    { buildId: await readBuildId() },
    {
      // Never cached anywhere. A cached answer to "which build is running"
      // is the one answer that is certainly wrong after a deploy, and this
      // is the thing that notices deploys.
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
