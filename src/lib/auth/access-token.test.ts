import { describe, expect, it } from "vitest";

import {
  accessTokenExpiry,
  accessTokenHashMatches,
  accessTokenState,
  hashAccessToken,
  looksLikeAccessToken,
  mintAccessToken,
} from "./access-token";

// -------------------------------------------------------------------
// The token string itself.
//
// These are properties rather than examples, because the value is random by
// design and the things that matter about it are structural: it cannot be
// recovered from what is stored, it is recognisable, and two of them are
// never the same.
// -------------------------------------------------------------------

describe("mintAccessToken", () => {
  it("returns a token, its hash, and a prefix that is none of it", () => {
    const minted = mintAccessToken();

    expect(minted.token).toMatch(/^aih_pat_/);
    expect(minted.tokenHash).toHaveLength(64);
    expect(minted.prefix.length).toBeLessThan(minted.token.length);
  });

  it("does not put the token in its own hash", () => {
    // Stating the obvious as a test, because the failure is catastrophic and
    // silent: a "hash" that contained the token would make the table worth
    // stealing while looking exactly like this one.
    const minted = mintAccessToken();

    expect(minted.tokenHash).not.toContain(minted.token);
    expect(minted.tokenHash).not.toContain(minted.token.slice(-20));
  });

  it("never mints the same token twice", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintAccessToken().token));

    expect(seen.size).toBe(200);
  });

  it("hashes deterministically, so a presented token can be found", () => {
    const minted = mintAccessToken();

    expect(hashAccessToken(minted.token)).toBe(minted.tokenHash);
  });

  it("keeps a prefix short enough to be useless on its own", () => {
    // Eight characters of base64url is 48 bits. It tells two of somebody's
    // tokens apart and narrows nothing for anybody else.
    const minted = mintAccessToken();

    expect(minted.prefix).toHaveLength("aih_pat_".length + 8);
    expect(minted.token.startsWith(minted.prefix)).toBe(true);
  });
});

describe("looksLikeAccessToken", () => {
  it("recognises one it just minted", () => {
    expect(looksLikeAccessToken(mintAccessToken().token)).toBe(true);
  });

  it("refuses anything else without needing a database", () => {
    // The point of the check: a stale cookie, a copied Graph token or
    // somebody's password should not become a query.
    for (const value of [
      "",
      "Bearer something",
      "aih_pat_",
      "aih_pat_tooshort",
      `aih_pat_${"a".repeat(44)}`,
      `aih_pat_${"a".repeat(42)}`,
      // Right length, wrong alphabet - base64url has no + or /.
      `aih_pat_${"a".repeat(41)}+/`,
      "sk-ant-api03-something-that-is-not-ours",
    ]) {
      expect(looksLikeAccessToken(value)).toBe(false);
    }
  });
});

describe("accessTokenHashMatches", () => {
  it("matches a hash with itself", () => {
    const hash = hashAccessToken("anything");

    expect(accessTokenHashMatches(hash, hash)).toBe(true);
  });

  it("refuses a different hash", () => {
    expect(accessTokenHashMatches(hashAccessToken("a"), hashAccessToken("b"))).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    // timingSafeEqual throws when the buffers differ in length, which would
    // turn a malformed row into a 500 on the authentication path.
    expect(accessTokenHashMatches("short", hashAccessToken("a"))).toBe(false);
  });
});

describe("accessTokenExpiry", () => {
  it("is ninety days out by default", () => {
    const now = new Date("2026-09-10T00:00:00Z");

    expect(accessTokenExpiry(90, now)?.toISOString()).toBe("2026-12-09T00:00:00.000Z");
  });

  it("allows a token that does not expire, because sometimes that is right", () => {
    expect(accessTokenExpiry(null)).toBeNull();
  });
});

describe("accessTokenState", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("is usable when it is neither revoked nor expired", () => {
    expect(
      accessTokenState({ revokedAt: null, expiresAt: new Date("2026-12-01T00:00:00Z") }, now),
    ).toEqual({ usable: true });
  });

  it("is usable forever when nothing was set to expire", () => {
    expect(accessTokenState({ revokedAt: null, expiresAt: null }, now)).toEqual({ usable: true });
  });

  it("tells revoked apart from expired, because the remedies differ", () => {
    expect(accessTokenState({ revokedAt: now, expiresAt: null }, now)).toEqual({
      usable: false,
      reason: "revoked",
    });

    expect(
      accessTokenState({ revokedAt: null, expiresAt: new Date("2026-09-01T00:00:00Z") }, now),
    ).toEqual({ usable: false, reason: "expired" });
  });

  it("treats the instant of expiry as expired", () => {
    // A boundary somebody would otherwise pick the wrong side of, and the
    // safe side is the one that refuses.
    expect(accessTokenState({ revokedAt: null, expiresAt: now }, now).usable).toBe(false);
  });

  it("reports a revoked token as revoked even if it had also expired", () => {
    // Revocation is the deliberate act and is the more useful thing to be
    // told - "I turned that off" beats "it lapsed".
    const state = accessTokenState(
      { revokedAt: new Date("2026-09-05T00:00:00Z"), expiresAt: new Date("2026-09-01T00:00:00Z") },
      now,
    );

    expect(state).toEqual({ usable: false, reason: "revoked" });
  });
});
