import { expect, type APIRequestContext } from "@playwright/test";

import { readEnvVar } from "./env";
import { generateTotp, secretFromTotpUri } from "./totp";

// Better Auth rejects state-changing requests without an Origin header (CSRF).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// -------------------------------------------------------------------
// Turn on two-factor for an already-seeded user through the real API, and
// return the TOTP secret + backup codes so a test can complete the sign-in
// challenge with genuine values. `enable` only stages the secret; a correct
// TOTP code is what actually activates 2FA (so a bad scan can't lock anyone
// out), which mirrors the app's own setup wizard.
// -------------------------------------------------------------------
export async function enableTwoFactor(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ secret: string; backupCodes: string[] }> {
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password },
  });
  expect(signIn.ok(), "sign-in before enabling 2FA failed").toBeTruthy();

  const enable = await request.post("/api/auth/two-factor/enable", {
    headers: { Origin: ORIGIN },
    data: { password },
  });
  expect(enable.ok(), "two-factor enable failed").toBeTruthy();
  const staged = (await enable.json()) as { totpURI: string; backupCodes: string[] };
  const secret = secretFromTotpUri(staged.totpURI);

  const verify = await request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: ORIGIN },
    data: { code: generateTotp(secret) },
  });
  expect(verify.ok(), "two-factor verify-totp during setup failed").toBeTruthy();

  // Sign the setup session out so the test drives a clean, fresh sign-in.
  await request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN } });

  return { secret, backupCodes: staged.backupCodes };
}
