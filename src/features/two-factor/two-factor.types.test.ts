import { describe, expect, it } from "vitest";

import {
  TWO_FACTOR_LOCK_MINUTES,
  TWO_FACTOR_MAX_ATTEMPTS,
  VerifyTwoFactorSchema,
} from "./two-factor.types";

// -------------------------------------------------------------------
// The boundary schema for a two-factor code.
//
// Worth testing directly because it is the only thing standing between the
// client and the verification path, and because the temptation to "tighten"
// it to six digits is real and would break every backup code.
// -------------------------------------------------------------------
describe("VerifyTwoFactorSchema", () => {
  it("accepts a six-digit TOTP code", () => {
    const result = VerifyTwoFactorSchema.safeParse({ code: "123456", useBackupCode: false });

    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace, which is what pasting a code produces", () => {
    const result = VerifyTwoFactorSchema.safeParse({ code: "  123456 ", useBackupCode: false });

    expect(result.success).toBe(true);
    expect(result.success && result.data.code).toBe("123456");
  });

  it("accepts a backup code containing a separator", () => {
    // Backup codes are not digits and may carry a hyphen. A six-digit rule
    // here would reject every one of them, at the exact moment somebody has
    // lost their phone and has nothing else to try.
    const result = VerifyTwoFactorSchema.safeParse({
      code: "abcde-fghij",
      useBackupCode: true,
    });

    expect(result.success).toBe(true);
  });

  it("defaults useBackupCode to false when the client omits it", () => {
    const result = VerifyTwoFactorSchema.safeParse({ code: "123456" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.useBackupCode).toBe(false);
  });

  it("rejects an empty code rather than sending it to the verifier", () => {
    const result = VerifyTwoFactorSchema.safeParse({ code: "   ", useBackupCode: false });

    expect(result.success).toBe(false);
  });

  it("rejects an absurdly long code", () => {
    // Bounded so a caller cannot post a megabyte into the verification path.
    const result = VerifyTwoFactorSchema.safeParse({
      code: "1".repeat(65),
      useBackupCode: false,
    });

    expect(result.success).toBe(false);
  });
});

// -------------------------------------------------------------------
// The lockout numbers are load-bearing, not decoration.
//
// Better Auth's own attempt limiter does not run on this path - when a
// session already exists its beginAttempt returns no-op handlers - so these
// constants are the ONLY thing bounding guesses at a six-digit code. A
// change that removed the limit, or set it high enough not to matter, is
// worth failing a build over.
// -------------------------------------------------------------------
describe("two-factor lockout policy", () => {
  it("bounds attempts low enough to matter against a six-digit space", () => {
    expect(TWO_FACTOR_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(TWO_FACTOR_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it("locks for long enough that retrying is not free", () => {
    expect(TWO_FACTOR_LOCK_MINUTES).toBeGreaterThanOrEqual(5);
  });
});
