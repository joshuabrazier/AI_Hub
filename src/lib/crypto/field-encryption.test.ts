import { describe, expect, it, vi } from "vitest";

// field-encryption.ts is marked "server-only", which throws when imported
// outside a React Server context (i.e. under Vitest). Neutralise it so we can
// unit-test the pure crypto. The real FIELD_ENCRYPTION_KEY comes from the
// loaded .env (CI supplies a dummy one).
vi.mock("server-only", () => ({}));

import { decryptField, encryptField } from "./field-encryption";

describe("field encryption (AES-256-GCM)", () => {
  it("round-trips a value back to the original plaintext", () => {
    const secret = "Signed by Jane Doe";
    expect(decryptField(encryptField(secret))).toBe(secret);
  });

  it("round-trips unicode, long and JSON values (the shapes the app stores)", () => {
    for (const value of ["🏊 allergy: peanuts — EpiPen", "x".repeat(5000), JSON.stringify({ a: 1, b: [2, 3] })]) {
      expect(decryptField(encryptField(value))).toBe(value);
    }
  });

  it("produces the versioned 4-part payload", () => {
    const parts = encryptField("hello").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("uses a fresh IV each time, so identical plaintext gives different ciphertext", () => {
    expect(encryptField("same")).not.toBe(encryptField("same"));
  });

  it("rejects a tampered ciphertext (GCM auth tag fails)", () => {
    // Flip the FIRST character of the ciphertext segment to something it is
    // definitely not, so the payload always actually changes.
    //
    // The previous version of this test read the LAST character to choose a
    // replacement but substituted the FIRST one, so whenever the first
    // character already happened to equal that replacement the ciphertext was
    // left untouched, decryption succeeded and the assertion failed. That is
    // roughly 1 run in 64 - frequent enough to fail CI regularly, rare enough
    // to be dismissed as a flake, on the assertion that proves tampered data
    // is rejected. Tamper deterministically instead.
    const parts = encryptField("sensitive").split(":");
    const ciphertext = parts[3];
    const first = ciphertext[0];
    parts[3] = (first === "A" ? "B" : "A") + ciphertext.slice(1);

    expect(parts[3]).not.toBe(ciphertext);
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("rejects a tampered ciphertext however the bytes are flipped", () => {
    // The single-character case above can only exercise one position. Sweep
    // every position so a change anywhere in the ciphertext is caught.
    for (let index = 0; index < 24; index++) {
      const parts = encryptField("sensitive value").split(":");
      const ciphertext = parts[3];
      if (index >= ciphertext.length) break;

      const original = ciphertext[index];
      const replacement = original === "A" ? "B" : "A";
      parts[3] = ciphertext.slice(0, index) + replacement + ciphertext.slice(index + 1);

      expect(parts[3]).not.toBe(ciphertext);
      expect(() => decryptField(parts.join(":"))).toThrow();
    }
  });

  it("rejects a swapped auth tag", () => {
    const a = encryptField("one").split(":");
    const b = encryptField("two").split(":");
    a[2] = b[2]; // graft b's auth tag onto a
    expect(() => decryptField(a.join(":"))).toThrow();
  });

  it("rejects malformed and wrong-version payloads", () => {
    expect(() => decryptField("not-a-payload")).toThrow("Invalid encrypted payload");
    expect(() => decryptField("v2:aaa:bbb:ccc")).toThrow("Invalid encrypted payload");
    expect(() => decryptField("v1::bbb:ccc")).toThrow("Invalid encrypted payload");
  });
});
