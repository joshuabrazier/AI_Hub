import { createHmac } from "node:crypto";

// -------------------------------------------------------------------
// TOTP (RFC 6238) generation for E2E tests.
//
// Better Auth uses standard TOTP defaults (SHA1, 6 digits, 30s period), so a
// plain implementation here produces codes its verifier accepts. We only need
// this in tests - the app never generates codes, it only verifies them.
// -------------------------------------------------------------------

// Decode an RFC 4648 base32 string (as used in otpauth:// secrets) to bytes.
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

// Generate the current TOTP code for a base32 secret. `offset` shifts the
// 30-second window (0 = now), useful only if a boundary needs nudging.
export function generateTotp(secretBase32: string, offset = 0): string {
  const period = 30;
  const digits = 6;
  const counter = Math.floor(Date.now() / 1000 / period) + offset;

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const truncationOffset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[truncationOffset] & 0x7f) << 24) |
    ((hmac[truncationOffset + 1] & 0xff) << 16) |
    ((hmac[truncationOffset + 2] & 0xff) << 8) |
    (hmac[truncationOffset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

// Pull the base32 secret out of an otpauth:// URI returned by the enable step.
export function secretFromTotpUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("no secret found in totpURI");
  return secret;
}
