import "server-only";

import {
  getPersonalAccessTokenByHashRepo,
  touchPersonalAccessTokenRepo,
} from "@/lib/data/repositories/personal-access-tokens.repository";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import { type UserRole } from "@/lib/data/kysely-database-types";

import {
  accessTokenHashMatches,
  accessTokenState,
  hashAccessToken,
  looksLikeAccessToken,
  type AccessTokenScope,
} from "./access-token";

// ===================================================================
// A BEARER TOKEN TO AN ACTOR
//
// The other way in. Everything else in this app resolves who is calling from
// a Better Auth session cookie; this resolves it from a token, for callers
// that have no browser - Claude Code, a script, anything outside.
//
// IT IS NOT A GENERAL REPLACEMENT FOR getVerifiedApiSession, AND MUST NOT
// BECOME ONE. A session carries the second factor; a token cannot, because
// there is no session for isTwoFactorSatisfied to check. So a route opts IN
// to token auth by calling this and naming the scope it needs, and every
// route that does not call it is unreachable by token. That containment is
// the entire mitigation for skipping the factor: the exposure is one
// endpoint rather than the application.
//
// WHY IT RETURNS A ROLE RATHER THAN A DECISION. The service downstream
// re-checks the role itself - applyProjectPlanService refuses a non-admin
// whatever this says - so this establishes identity and leaves authorization
// where it already lives. A function here that decided "may create a
// project" would be a second copy of a rule, in the layer least likely to be
// updated when the rule changes.
//
// EVERY REFUSAL IS THE SAME SHAPE TO THE CALLER. A revoked token, an expired
// one, a token for a deactivated account and a string this app never issued
// all answer 401. The reason is logged, never returned: telling a caller
// "that token is expired" confirms it was real, which is a thing worth
// knowing to somebody who found it written down.
// ===================================================================

export type TokenActor = {
  id: string;
  role: UserRole;
  name: string | null;
  tokenId: string;
};

export type TokenAuthResult =
  | { ok: true; actor: TokenActor }
  // `reason` is for the server log. It is deliberately not for the response.
  | { ok: false; reason: string };

export async function authenticateAccessToken(
  request: Request,
  scope: AccessTokenScope,
): Promise<TokenAuthResult> {
  const presented = readBearer(request.headers.get("authorization"));

  if (!presented) return { ok: false, reason: "no bearer token" };

  // Refused on shape before a query. Anything arriving with an Authorization
  // header that is not one of ours - a stale cookie value, somebody's
  // password, a token for another service - costs nothing.
  if (!looksLikeAccessToken(presented)) return { ok: false, reason: "not a token of ours" };

  const hash = hashAccessToken(presented);

  const row = await getPersonalAccessTokenByHashRepo(hash);

  if (!row) return { ok: false, reason: "no such token" };

  // The lookup was BY hash, so this can only fail if two rows collided - but
  // a comparison that returns early on the first differing byte is the kind
  // of thing that gets reused where it matters.
  if (!accessTokenHashMatches(row.tokenHash, hash)) {
    return { ok: false, reason: "hash mismatch" };
  }

  const state = accessTokenState(row);

  if (!state.usable) return { ok: false, reason: `token ${state.reason}` };

  // SCOPE IS CHECKED HERE, at the door the route opted into. A token minted
  // for one surface cannot reach another because a widened service does not
  // widen the token.
  if (row.scope !== scope) {
    return { ok: false, reason: `token scope ${row.scope} does not cover ${scope}` };
  }

  const user = await getUserByUserIdRepo(row.userId);

  if (!user) return { ok: false, reason: "token belongs to no account" };

  // A DEACTIVATED ACCOUNT'S TOKENS STOP WORKING, and this is the only place
  // that can enforce it. Deactivating somebody ends their sessions; it knows
  // nothing about tokens, so without this check the credential of a person
  // who has left would outlive their access by up to ninety days.
  if (!user.isActive) return { ok: false, reason: "account is deactivated" };

  // -----------------------------------------------------------------
  // Recorded, and NOT awaited. This answers "is this still being used"
  // before somebody revokes a token they have forgotten the purpose of, and
  // shows a leaked one being used at all - neither of which is worth
  // failing or delaying the request for. A write that fails is logged by the
  // repository and changes nothing else.
  // -----------------------------------------------------------------
  void touchPersonalAccessTokenRepo(row.id, new Date()).catch((error: unknown) => {
    console.warn(`authenticateAccessToken: could not record use of token ${row.id}`, error);
  });

  return {
    ok: true,
    actor: { id: user.id, role: user.role, name: user.name ?? null, tokenId: row.id },
  };
}

// The scheme is case-insensitive per RFC 7235, and the number of people who
// will type "bearer" is not zero.
function readBearer(header: string | null): string | null {
  if (!header) return null;

  const match = /^bearer\s+(.+)$/i.exec(header.trim());

  return match ? match[1].trim() : null;
}
