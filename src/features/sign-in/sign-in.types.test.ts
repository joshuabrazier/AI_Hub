import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { signInSchema } from "./sign-in.types";

// -------------------------------------------------------------------
// signInSchema
// -------------------------------------------------------------------
describe("signInSchema", () => {
  const validPassword = "a".repeat(PASSWORD_MIN_LENGTH);

  it("accepts a valid email and password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: validPassword,
      rememberMe: false,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a remembered session", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: validPassword,
      rememberMe: true,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed email address", () => {
    const result = signInSchema.safeParse({
      email: "not-an-email",
      password: validPassword,
      rememberMe: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than the minimum length", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "a".repeat(PASSWORD_MIN_LENGTH - 1),
      rememberMe: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a password longer than the maximum length", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "a".repeat(PASSWORD_MAX_LENGTH + 1),
      rememberMe: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing rememberMe flag", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: validPassword,
    });

    expect(result.success).toBe(false);
  });
});
