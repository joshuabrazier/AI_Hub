import "server-only";

import { auth } from "../auth/auth";
import { FAKE_GRAPH_TOKEN, isFakeSharepointEnabled } from "./dev-fake";
import { GRAPH_OUTCOMES, GraphRequestError } from "./graph-client";

// -------------------------------------------------------------------
// A delegated Graph access token, for a person who may not be present
//
// THE WHOLE ACCESS-CONTROL STORY OF PHASE 1 IS IN THE WORD "DELEGATED".
// Every Graph call is made as a named user, so SharePoint enforces
// permissions and our code does not. A crawl cannot reach a library the
// person it runs as could not already open themselves. That is worth more
// than anything we could build, and it is why app-only Sites.Selected was
// rejected for this phase: with app-only, our service layer becomes the
// only thing standing between a crawl and a restricted HR folder.
//
// THE SPEC SAID THIS MEANT NO BACKGROUND WORK. It does not, and the
// difference decides whether a crawl can resume.
//
// Better Auth resolves the user for getAccessToken like this:
//
//   const session = await getSessionFromCtx(ctx, ...);
//   if (!session && (ctx.request || ctx.headers)) throw ctx.error("UNAUTHORIZED");
//   const resolvedUserId = session?.user?.id || userId;
//
// Called WITHOUT headers, there is no request to fail the check, so it
// falls through to the userId we pass and mints a token from the stored
// refresh token. Nobody has to be signed in and looking. An access token
// lives about an hour; the refresh token behind it lives far longer, and
// that is what a resumed crawl runs on.
//
// TWO CONSEQUENCES, BOTH LOAD-BEARING:
//
//   1. Note the ordering: a session, when present, WINS over the passed
//      userId. So this can never be used from a request to act as somebody
//      else - but it also means the headerless form is the only one that
//      works for an absent user, and that form is a privileged path. It
//      must never be reachable from a request handler with a user id taken
//      off a URL or a form. Every caller here passes an id read from a
//      crawl row that an admin created.
//
//   2. The refresh token is the real limit, not the hour. It lapses, and
//      Entra revokes it on a password change, an MFA change, an admin
//      revocation or a Conditional Access policy. When that happens no
//      amount of retrying helps and a named person has to sign in again,
//      which is why that case is classified rather than thrown as a
//      generic failure.
//
// ===================================================================
// UNCONFIRMED AGAINST A REAL TENANT
// ===================================================================
// Nothing in this file has been exercised against Entra. The development
// database has no Microsoft accounts at all - every row is a local
// password account - and MICROSOFT_CLIENT_ID is unset here, so there was
// no way to complete a sign-in and observe what comes back.
//
// What IS confirmed, by reading the library: Better Auth's Entra provider
// already requests `offline_access`, so a refresh token is issued and
// stored on the accounts row; `options.scope` is appended to its defaults,
// so adding Graph scopes is additive; and the resolver above behaves as
// quoted. What is NOT confirmed is the shape of a real failure. The
// classification below is therefore deliberately broad, and errs towards
// "a person must re-consent" - the answer that asks a human to look,
// rather than the one that retries quietly.
// -------------------------------------------------------------------

// The provider id Better Auth stores for the Entra provider configured in
// auth.ts. Named once, because a typo would resolve no account and read as
// "this person never signed in with Microsoft".
const MICROSOFT_PROVIDER_ID = "microsoft";

// The scopes themselves live in graph-client.ts, because auth.ts has to
// request them and this module imports auth.ts - defining them here would
// be a cycle.

// -------------------------------------------------------------------
// Get a usable token, or say why not.
//
// Refreshing is Better Auth's job, not ours: getAccessToken returns the
// stored token when it is still valid and refreshes it when it is not, so
// there is no expiry arithmetic here to get wrong.
// -------------------------------------------------------------------
export async function getDelegatedGraphToken(userId: string): Promise<string> {
  // Local development against a fake SharePoint. There is no Microsoft
  // account to mint a token from and nothing real on the other end to
  // protect - see dev-fake.ts for the two conditions, both of which must
  // hold and neither of which can hold on a deployed environment.
  if (isFakeSharepointEnabled()) return FAKE_GRAPH_TOKEN;

  let result;

  try {
    result = await auth.api.getAccessToken({
      body: { providerId: MICROSOFT_PROVIDER_ID, userId },
      // NO HEADERS, DELIBERATELY. See the note above: passing them would
      // make the caller's session win over `userId`, which is right for a
      // request and wrong for a crawl running on behalf of somebody who is
      // not here.
    });
  } catch (error) {
    // Everything that can go wrong here has the same remedy: a person
    // signs in again. A missing account, a lapsed refresh token, a revoked
    // grant and a scope that was never consented to are indistinguishable
    // from the outside, and all four are fixed the same way.
    throw new GraphRequestError(
      `No usable Microsoft token for this account: ${error instanceof Error ? error.message : String(error)}`,
      { outcome: GRAPH_OUTCOMES.NEEDS_REAUTH },
    );
  }

  const accessToken = result?.accessToken;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    // A success with no token is not a token. Letting an empty string
    // through would produce a 401 on the next call and report itself as a
    // Graph problem rather than an account one.
    throw new GraphRequestError("Microsoft returned no access token for this account", {
      outcome: GRAPH_OUTCOMES.NEEDS_REAUTH,
    });
  }

  return accessToken;
}
