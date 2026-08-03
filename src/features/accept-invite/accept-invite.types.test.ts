import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, TABLE_ID_LENGTH } from "@/lib/constants";
import { AcceptInviteAndSignUpSchema, ValidateInviteSchema } from "./accept-invite.types";

// -------------------------------------------------------------------
// ValidateInviteSchema
// -------------------------------------------------------------------
describe("ValidateInviteSchema", () => {
  const validToken = "a".repeat(TABLE_ID_LENGTH);

  it("accepts a token of sufficient length", () => {
    const result = ValidateInviteSchema.safeParse({ inviteToken: validToken });

    expect(result.success).toBe(true);
  });

  it("rejects a token shorter than the required length", () => {
    const result = ValidateInviteSchema.safeParse({ inviteToken: "a".repeat(TABLE_ID_LENGTH - 1) });

    expect(result.success).toBe(false);
  });

  it("rejects a missing token", () => {
    const result = ValidateInviteSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

// -------------------------------------------------------------------
// AcceptInviteAndSignUpSchema
// -------------------------------------------------------------------
describe("AcceptInviteAndSignUpSchema", () => {
  const validToken = "a".repeat(TABLE_ID_LENGTH);
  const validPassword = "a".repeat(PASSWORD_MIN_LENGTH);

  it("accepts a valid token with matching passwords within the length bounds", () => {
    const result = AcceptInviteAndSignUpSchema.safeParse({
      inviteToken: validToken,
      password: validPassword,
      confirmPassword: validPassword,
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the passwords do not match", () => {
    const result = AcceptInviteAndSignUpSchema.safeParse({
      inviteToken: validToken,
      password: validPassword,
      confirmPassword: `${validPassword}b`,
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      // The mismatch error must be reported against confirmPassword
      const mismatch = result.error.issues.find((issue) => issue.path[0] === "confirmPassword");
      expect(mismatch).toBeDefined();
    }
  });

  it("rejects a password shorter than the minimum length", () => {
    const tooShort = "a".repeat(PASSWORD_MIN_LENGTH - 1);

    const result = AcceptInviteAndSignUpSchema.safeParse({
      inviteToken: validToken,
      password: tooShort,
      confirmPassword: tooShort,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password longer than the maximum length", () => {
    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);

    const result = AcceptInviteAndSignUpSchema.safeParse({
      inviteToken: validToken,
      password: tooLong,
      confirmPassword: tooLong,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a token shorter than the required length", () => {
    const result = AcceptInviteAndSignUpSchema.safeParse({
      inviteToken: "a".repeat(TABLE_ID_LENGTH - 1),
      password: validPassword,
      confirmPassword: validPassword,
    });

    expect(result.success).toBe(false);
  });
});
