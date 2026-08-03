import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { resetPasswordSchema } from "./reset-password.types";

// -------------------------------------------------------------------
// resetPasswordSchema
// -------------------------------------------------------------------
describe("resetPasswordSchema", () => {
  const validPassword = "a".repeat(PASSWORD_MIN_LENGTH);

  it("accepts matching passwords within the length bounds", () => {
    const result = resetPasswordSchema.safeParse({
      password: validPassword,
      confirmPassword: validPassword,
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the passwords do not match", () => {
    const result = resetPasswordSchema.safeParse({
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

    const result = resetPasswordSchema.safeParse({
      password: tooShort,
      confirmPassword: tooShort,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password longer than the maximum length", () => {
    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);

    const result = resetPasswordSchema.safeParse({
      password: tooLong,
      confirmPassword: tooLong,
    });

    expect(result.success).toBe(false);
  });
});
