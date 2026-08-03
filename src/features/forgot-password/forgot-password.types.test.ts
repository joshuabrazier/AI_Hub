import { describe, expect, it } from "vitest";
import { forgotPasswordSchema } from "./forgot-password.types";

// -------------------------------------------------------------------
// forgotPasswordSchema
// -------------------------------------------------------------------
describe("forgotPasswordSchema", () => {
  it("accepts a valid email address", () => {
    const result = forgotPasswordSchema.safeParse({ email: "user@example.com" });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed email address", () => {
    const result = forgotPasswordSchema.safeParse({ email: "not-an-email" });

    expect(result.success).toBe(false);
  });

  it("rejects an empty email address", () => {
    const result = forgotPasswordSchema.safeParse({ email: "" });

    expect(result.success).toBe(false);
  });

  it("rejects a missing email field", () => {
    const result = forgotPasswordSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});
