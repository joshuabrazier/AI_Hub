import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { changePasswordSchema } from "./change-password.types";

// -------------------------------------------------------------------
// changePasswordSchema
// -------------------------------------------------------------------
describe("changePasswordSchema", () => {
  const validPassword = "a".repeat(PASSWORD_MIN_LENGTH);

  it("accepts a current password with matching new passwords within the length bounds", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: validPassword,
      confirmNewPassword: validPassword,
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the current password is empty", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: validPassword,
      confirmNewPassword: validPassword,
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const currentPasswordError = result.error.issues.find((issue) => issue.path[0] === "currentPassword");
      expect(currentPasswordError).toBeDefined();
    }
  });

  it("rejects when the new passwords do not match", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: validPassword,
      confirmNewPassword: `${validPassword}b`,
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      // The mismatch error must be reported against confirmNewPassword
      const mismatch = result.error.issues.find((issue) => issue.path[0] === "confirmNewPassword");
      expect(mismatch).toBeDefined();
    }
  });

  it("rejects a new password shorter than the minimum length", () => {
    const tooShort = "a".repeat(PASSWORD_MIN_LENGTH - 1);

    const result = changePasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: tooShort,
      confirmNewPassword: tooShort,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a new password longer than the maximum length", () => {
    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);

    const result = changePasswordSchema.safeParse({
      currentPassword: "current-password",
      newPassword: tooLong,
      confirmNewPassword: tooLong,
    });

    expect(result.success).toBe(false);
  });
});
