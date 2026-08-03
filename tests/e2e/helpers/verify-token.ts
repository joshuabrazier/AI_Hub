import { createHmac } from "crypto";
import { readEnvVar } from "./env";

// -------------------------------------------------------------------
// Better Auth signs email-change verification tokens as a stateless
// HS256 JWT (see better-auth's crypto `signJWT`) - unlike the reset
// token it is NOT stored in the DB, and in tests the email carrying it
// is only logged, so Playwright can't read it back. We reconstruct the
// exact token Better Auth would email so we can drive the verify step.
//
// Payload mirrors createEmailVerificationToken(secret, currentEmail,
// newEmail, ..., { requestType: "change-email-verification" }).
// -------------------------------------------------------------------
function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

export function buildChangeEmailVerificationToken(currentEmail: string, newEmail: string): string {
  const secret = readEnvVar("BETTER_AUTH_SECRET");
  const nowInSeconds = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "HS256" }));
  const payload = base64url(
    JSON.stringify({
      email: currentEmail.toLowerCase(),
      updateTo: newEmail.toLowerCase(),
      requestType: "change-email-verification",
      iat: nowInSeconds,
      exp: nowInSeconds + 3600,
    }),
  );

  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");

  return `${data}.${signature}`;
}
