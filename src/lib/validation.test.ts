import { describe, expect, it } from "vitest";

import { phoneNumberSchema } from "./validation";

describe("phoneNumberSchema", () => {
  const schema = phoneNumberSchema();
  const accepts = (value: string) => schema.safeParse(value).success;

  it("accepts plausible phone numbers", () => {
    expect(accepts("0412 345 678")).toBe(true); // AU mobile
    expect(accepts("+61 412 345 678")).toBe(true); // international
    expect(accepts("(02) 9876-5432")).toBe(true); // landline with separators
    expect(accepts("  0412345678  ")).toBe(true); // trimmed
  });

  it("rejects free text and non-phone input", () => {
    expect(accepts("call me")).toBe(false);
    expect(accepts("0412-abc-678")).toBe(false); // letters
    expect(accepts("")).toBe(false); // empty
  });

  it("requires at least 8 digits", () => {
    expect(accepts("12345")).toBe(false);
    expect(accepts("1234 567")).toBe(false); // 7 digits
    expect(accepts("1234 5678")).toBe(true); // 8 digits
  });

  it("honours a custom max length", () => {
    expect(phoneNumberSchema({ max: 10 }).safeParse("+61 412 345 678 999").success).toBe(false);
  });

  it("uses a custom required message when empty", () => {
    const result = phoneNumberSchema({ requiredMessage: "Phone is required" }).safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Phone is required");
  });
});
