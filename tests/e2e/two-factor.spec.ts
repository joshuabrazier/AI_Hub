import type { APIRequestContext } from "@playwright/test";

import { test, expect } from "./helpers/test";

import { deleteUserByEmail, getLatestTwoFactorOtp } from "./helpers/db";
import { readEnvVar } from "./helpers/env";
import { SEED_PASSWORD } from "./helpers/seed";
import { fillAndSubmit } from "./helpers/sign-in";
import { enableTwoFactor } from "./helpers/two-factor";
import { generateTotp } from "./helpers/totp";

// Better Auth rejects state-changing requests without an Origin header (CSRF).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Track the throwaway users each run seeds so they can be removed afterwards.
// Deleting the user cascades to its two_factor row (ON DELETE CASCADE).
const emailsToCleanup: string[] = [];

async function seedUser(request: APIRequestContext, email: string) {
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "E2E Two Factor", email, password: SEED_PASSWORD },
  });
  expect(signUp.ok(), "failed to seed test user").toBeTruthy();
}

// Sign in with the password only; a 2FA user is then sent to the challenge page
// instead of straight into the app.
async function reachChallenge(page: import("@playwright/test").Page, email: string) {
  await page.goto("/sign-in");
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  });

  await expect(page).toHaveURL(/\/two-factor/);
  await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible();
}

test.afterEach(async () => {
  while (emailsToCleanup.length) {
    await deleteUserByEmail(emailsToCleanup.pop() as string);
  }
});

// -------------------------------------------------------------------
// Two-factor sign-in: the three ways a user can complete the challenge.
//
// ORDER MATTERS in every one of these. Better Auth only issues a session at
// sign-in while two_factor_enabled is false; once it is true, sign-in returns
// a challenge and no session. So each test seeds the account first and turns
// 2FA on afterwards (which is what enableTwoFactor does internally), and the
// browser then completes the challenge with the real secret. Turning 2FA on
// before there is an account to sign in with fails in a way that looks exactly
// like an authorization problem and is not one.
//
// These accounts are members, for whom 2FA is optional. Staff are separately
// required to enrol before the proxy lets them into /admin or /manage.
// -------------------------------------------------------------------
test("a 2FA user signs in with an authenticator code", async ({ page, request }) => {
  const email = `e2e-2fa-totp-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  await seedUser(request, email);
  const { secret } = await enableTwoFactor(request, email, SEED_PASSWORD);

  await reachChallenge(page, email);
  // The code is minted INSIDE the retry closure, so a retry gets a fresh one.
  // A code generated once outside could fall outside its 30-second window while
  // the challenge page was still hydrating, and be rejected for being stale
  // rather than wrong.
  await fillAndSubmit(page.getByRole("button", { name: /^verify$/i }), async () => {
    await page.getByLabel(/authentication code/i).fill(generateTotp(secret));
  });

  // A correct code completes sign-in and the app redirects off /two-factor.
  await expect(page).not.toHaveURL(/\/two-factor/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/sign-in/);
  // Verifying hard-navigates so the proxy re-runs with the completed session
  // and routes the role to its own area - a member's is the portal.
  await expect(page).toHaveURL(/\/portal\/?$/, { timeout: 15_000 });
});

test("a 2FA user signs in with an emailed code", async ({ page, request }) => {
  const email = `e2e-2fa-otp-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  await seedUser(request, email);
  await enableTwoFactor(request, email, SEED_PASSWORD);

  await reachChallenge(page, email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await expect(page.getByText(/emailed you a code/i)).toBeVisible();

  const otp = await getLatestTwoFactorOtp();
  expect(otp, "no emailed OTP found in the verifications table").toBeTruthy();
  await fillAndSubmit(page.getByRole("button", { name: /^verify$/i }), async () => {
    await page.getByLabel(/email code/i).fill(otp as string);
  });

  await expect(page).not.toHaveURL(/\/two-factor/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test("a 2FA user signs in with a backup code", async ({ page, request }) => {
  const email = `e2e-2fa-backup-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  await seedUser(request, email);
  const { backupCodes } = await enableTwoFactor(request, email, SEED_PASSWORD);

  await reachChallenge(page, email);
  await page.getByRole("button", { name: /use a backup code/i }).click();
  await fillAndSubmit(page.getByRole("button", { name: /^verify$/i }), async () => {
    await page.getByLabel(/backup code/i).fill(backupCodes[0]);
  });

  await expect(page).not.toHaveURL(/\/two-factor/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test("a wrong authenticator code is rejected and stays on the challenge", async ({ page, request }) => {
  const email = `e2e-2fa-bad-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  await seedUser(request, email);
  await enableTwoFactor(request, email, SEED_PASSWORD);

  await reachChallenge(page, email);
  await fillAndSubmit(page.getByRole("button", { name: /^verify$/i }), async () => {
    await page.getByLabel(/authentication code/i).fill("000000");
  });

  await expect(page.getByText(/didn't match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/two-factor/);
});
