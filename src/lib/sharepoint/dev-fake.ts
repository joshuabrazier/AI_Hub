import "server-only";

import { SITE_MODES } from "../constants";
import { envServer } from "../env-server";

// -------------------------------------------------------------------
// Pointing the crawl at a fake SharePoint, for local development only
//
// WHY THIS EXISTS, and it is the same argument as DEV_PASSWORD_SIGN_IN.
//
// This feature runs entirely on a delegated Microsoft token. With no
// MICROSOFT_* variables configured there is no Microsoft sign-in, so there
// is no token, so the crawl cannot be run AT ALL - not partly, not with
// reduced results, not at all. That is a real problem for a contributor
// who has no Entra tenant to point at, and it is the identical shape of
// problem the password sign-in door was opened for.
//
// IT IS LOCAL-ONLY BY CONSTRUCTION, with the same TWO conditions, and for
// the same reason: an .env gets copied.
//
//   1. DEV_FAKE_SHAREPOINT_URL must be set, and
//   2. MODE must not be production.
//
// Neither alone is enough. Setting the variable on a deployed environment
// does nothing.
//
// WHAT IT OPENS, precisely: the crawl talks to a server you are running
// instead of graph.microsoft.com, and skips minting a real token. That is
// the whole of it.
//
// WHAT IT DOES NOT OPEN: it hands out no access to anything. There is no
// real SharePoint on the other end, so there is nothing to read that you
// did not generate yourself. It cannot widen what any user can see,
// because it replaces the data source entirely rather than bypassing a
// check on real data - if this is on, every figure on the screen is fake
// and obviously so.
//
// WHAT IT CANNOT PROVE: that your tenant works. The fake answers the way
// Microsoft's own reference says Graph answers, which is exactly the thing
// that might be wrong. It proves the state machine, not the contract.
// -------------------------------------------------------------------

// The token handed to the fake server. Not a credential and not treated as
// one anywhere - the fake ignores it. Named rather than empty so a request
// arriving at a REAL Graph endpoint with this in the header fails loudly as
// an obviously bogus token rather than as a missing header.
export const FAKE_GRAPH_TOKEN = "dev-fake-sharepoint-not-a-real-token";

// -------------------------------------------------------------------
// The fake base URL, or null when the door is shut.
//
// Both conditions in one place, so there is exactly one predicate to audit
// and no way to satisfy half of it.
// -------------------------------------------------------------------
export function fakeSharepointBaseUrl(): string | null {
  if (envServer.MODE === SITE_MODES.PRODUCTION) return null;

  return envServer.DEV_FAKE_SHAREPOINT_URL ?? null;
}

export function isFakeSharepointEnabled(): boolean {
  return fakeSharepointBaseUrl() !== null;
}
