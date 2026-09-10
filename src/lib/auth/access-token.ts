import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ===================================================================
// MINTING AND RECOGNISING A PERSONAL ACCESS TOKEN
//
// The string itself, and the three things that have to be true of it: it is
// unguessable, it is recognisable on sight, and what this app stores cannot
// be turned back into it.
//
// THE PREFIX IS NOT DECORATION. "aih_pat_" in front of every token is what
// makes one findable: a secret scanner can pattern-match it, a person can
// spot it in a pasted log, and the first characters stored in clear are what
// lets somebody match a leaked string to the row they need to revoke. A
// token that looks like any other random string is one nobody can trace.
//
// SHA-256 AND NOT A PASSWORD HASH, deliberately, and this is the one place
// somebody will reasonably want to "fix" it. Stretching exists to make
// guessing expensive, and there is nothing to guess here: this is 32 bytes
// from a cryptographic random source, not something a person chose. bcrypt
// on the verification path would add tens of milliseconds to every API call
// to defend against an attack that cannot happen. The threat this DOES
// defend against - somebody reading the table - is answered by not storing
// the plaintext at all.
//
// Pure and dependency-free, so the format and the comparison are testable
// without a database.
// ===================================================================

// Long enough that guessing is not a strategy: 32 bytes is 256 bits of
// entropy, which is the same order as the hash that stores it.
const TOKEN_BYTES = 32;

// Recognisable, and namespaced so it cannot be confused with a Bedrock key,
// a Graph token or anything else this app handles. Two segments because the
// first says whose it is and the second says what kind.
const TOKEN_PREFIX = "aih_pat_";

// How much of the token is kept in clear beside its hash. Enough to tell two
// of somebody's tokens apart in a list, short enough to be useless on its
// own - eight characters of base64url is 48 bits, so it narrows nothing.
const VISIBLE_PREFIX_CHARS = TOKEN_PREFIX.length + 8;

export type MintedToken = {
  // Shown to the person ONCE, at creation, and never recoverable. Nothing
  // stores this.
  token: string;
  // What goes in the database.
  tokenHash: string;
  // Kept in clear, for the list and for matching a leaked string to a row.
  prefix: string;
};

export function mintAccessToken(): MintedToken {
  // base64url rather than hex: the same entropy in two thirds of the
  // characters, and no padding to be mangled by a shell or a query string.
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

  return {
    token,
    tokenHash: hashAccessToken(token),
    prefix: token.slice(0, VISIBLE_PREFIX_CHARS),
  };
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// -------------------------------------------------------------------
// Is this string shaped like one of ours?
//
// A CHEAP REFUSAL BEFORE A DATABASE LOOKUP. Anything reaching an API with an
// Authorization header that is not one of these - a stale Better Auth
// cookie value, a copied Graph token, somebody's password - is refused
// without a query. That is not about security, it is about not turning every
// malformed request into database load.
// -------------------------------------------------------------------
export function looksLikeAccessToken(value: string): boolean {
  if (!value.startsWith(TOKEN_PREFIX)) return false;

  const body = value.slice(TOKEN_PREFIX.length);

  // base64url of 32 bytes is 43 characters. Checked exactly rather than as a
  // minimum, because a token of another length is not one of ours.
  return /^[A-Za-z0-9_-]{43}$/.test(body);
}

// -------------------------------------------------------------------
// Compare two hashes without leaking how much of them matched.
//
// TIMING-SAFE EVEN THOUGH BOTH SIDES ARE HASHES, which is belt and braces
// and costs nothing. The lookup is by hash so an attacker cannot steer it
// with a partial match anyway - but a comparison that returns early on the
// first differing byte is the kind of thing that gets reused somewhere it
// matters, and there is no version of this worth writing twice.
// -------------------------------------------------------------------
export function accessTokenHashMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch rather than returning false,
  // which would turn a malformed row into a 500.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

// -------------------------------------------------------------------
// The scopes a token can carry.
//
// NARROW ON PURPOSE. A token that could do anything its owner can do would
// be a way around the second factor for the whole application rather than
// for one endpoint - see the note in migration 026. A route opts IN to a
// scope, so widening a service cannot quietly widen every token.
// -------------------------------------------------------------------
export const ACCESS_TOKEN_SCOPES = {
  // Create a project, its phases, its tasks and its members from a plan.
  // Everything this scope reaches is admin-only regardless, and the service
  // re-checks the role - the scope narrows WHICH admin act, not who.
  DELIVERY_WRITE: "delivery:write",
} as const;

export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[keyof typeof ACCESS_TOKEN_SCOPES];

export const ACCESS_TOKEN_SCOPE_LABELS: Record<AccessTokenScope, string> = {
  [ACCESS_TOKEN_SCOPES.DELIVERY_WRITE]: "Create projects, phases and tasks",
};

// -------------------------------------------------------------------
// How long a new token lasts unless somebody says otherwise.
//
// Ninety days rather than never. A credential with no end is one nobody gets
// round to removing, and the cost of renewing one is a minute against the
// cost of a forgotten token on an old laptop.
// -------------------------------------------------------------------
export const ACCESS_TOKEN_DEFAULT_DAYS = 90;

export function accessTokenExpiry(days: number | null, now: Date = new Date()): Date | null {
  if (days === null) return null;

  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// -------------------------------------------------------------------
// Is a token still usable?
//
// Three ways not to be, and they are told apart because the remedies differ:
// a revoked token needs a new one, an expired token needs a new one, and an
// unknown token means the caller is holding something this app never issued.
// -------------------------------------------------------------------
export type AccessTokenState =
  | { usable: true }
  | { usable: false; reason: "revoked" | "expired" };

export function accessTokenState(
  token: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): AccessTokenState {
  if (token.revokedAt !== null) return { usable: false, reason: "revoked" };

  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) {
    return { usable: false, reason: "expired" };
  }

  return { usable: true };
}
