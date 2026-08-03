import { describe, expect, it } from "vitest";
import { changeEmailRequestSchema, changeEmailSchema } from "./change-email.types";

// -------------------------------------------------------------------
// changeEmailSchema (client form)
// -------------------------------------------------------------------
describe("changeEmailSchema", () => {
  it("accepts a current password with matching, valid new emails", () => {
    const result = changeEmailSchema.safeParse({
      currentPassword: "current-password",
      newEmail: "new@example.com",
      confirmNewEmail: "new@example.com",
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the current password is empty", () => {
    const result = changeEmailSchema.safeParse({
      currentPassword: "",
      newEmail: "new@example.com",
      confirmNewEmail: "new@example.com",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const currentPasswordError = result.error.issues.find((issue) => issue.path[0] === "currentPassword");
      expect(currentPasswordError).toBeDefined();
    }
  });

  it("rejects an invalid new email address", () => {
    const result = changeEmailSchema.safeParse({
      currentPassword: "current-password",
      newEmail: "not-an-email",
      confirmNewEmail: "not-an-email",
    });

    expect(result.success).toBe(false);
  });

  it("rejects when the new emails do not match", () => {
    const result = changeEmailSchema.safeParse({
      currentPassword: "current-password",
      newEmail: "new@example.com",
      confirmNewEmail: "different@example.com",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      // The mismatch error must be reported against confirmNewEmail
      const mismatch = result.error.issues.find((issue) => issue.path[0] === "confirmNewEmail");
      expect(mismatch).toBeDefined();
    }
  });
});

// -------------------------------------------------------------------
// changeEmailRequestSchema (server action)
// -------------------------------------------------------------------
describe("changeEmailRequestSchema", () => {
  it("accepts a current password and a valid new email", () => {
    const result = changeEmailRequestSchema.safeParse({
      currentPassword: "current-password",
      newEmail: "new@example.com",
    });

    expect(result.success).toBe(true);
  });

  it("rejects when the current password is empty", () => {
    const result = changeEmailRequestSchema.safeParse({
      currentPassword: "",
      newEmail: "new@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid new email address", () => {
    const result = changeEmailRequestSchema.safeParse({
      currentPassword: "current-password",
      newEmail: "not-an-email",
    });

    expect(result.success).toBe(false);
  });
});
