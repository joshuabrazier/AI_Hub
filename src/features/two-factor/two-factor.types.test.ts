import { describe, expect, it } from "vitest";

import {
  BeginTwoFactorEnrolmentSchema,
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

// -------------------------------------------------------------------
// Starting enrolment.
//
// The password is optional because in a real environment there is none to
// send: sign-in is Microsoft, an Entra account has no credential row, and
// Better Auth skips the password check for accounts that have none. It is
// present only for the local development account, which does have one - and
// without it that account could reach the enrolment screen and never get past
// it, which is what made the feature untestable on a developer machine.
// -------------------------------------------------------------------
describe("BeginTwoFactorEnrolmentSchema", () => {
  it("accepts no password at all, which is the production case", () => {
    const result = BeginTwoFactorEnrolmentSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.password).toBeUndefined();
  });

  it("accepts a password when one is supplied", () => {
    const result = BeginTwoFactorEnrolmentSchema.safeParse({ password: "Temp123!" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.password).toBe("Temp123!");
  });

  it("rejects an empty string rather than forwarding it as a password", () => {
    // An empty field must not reach the plugin looking like an attempt: the
    // service branches on the field being truthy to decide whether this is a
    // "no password supplied" or a "wrong password" failure, and an empty
    // string would send it down the wrong branch and show the wrong message.
    expect(BeginTwoFactorEnrolmentSchema.safeParse({ password: "" }).success).toBe(false);
  });

  it("bounds the length, so an oversized field cannot be forwarded", () => {
    expect(BeginTwoFactorEnrolmentSchema.safeParse({ password: "x".repeat(257) }).success).toBe(false);
    expect(BeginTwoFactorEnrolmentSchema.safeParse({ password: "x".repeat(256) }).success).toBe(true);
  });

  it("does not impose a minimum length beyond non-empty", () => {
    // This is an EXISTING password being re-entered, not one being chosen.
    // A minimum here would reject a valid short password and teach nothing;
    // the only authority on whether it is right is the auth layer.
    expect(BeginTwoFactorEnrolmentSchema.safeParse({ password: "a" }).success).toBe(true);
  });
});
