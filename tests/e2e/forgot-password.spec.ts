import { test, expect } from "./helpers/test";
import { deleteUserByEmail, getLatestResetToken } from "./helpers/db";
import { readEnvVar } from "./helpers/env";
import { fillAndSubmit } from "./helpers/sign-in";

// Better Auth rejects state-changing requests without an Origin header (CSRF
// protection). A real browser always sends one; Playwright's request client
// does not, so we set it explicitly to the app's origin (read from .env).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Track the throwaway user each run seeds so it can be removed afterwards
let seededEmail: string | undefined;

// -------------------------------------------------------------------
// Clean up the seeded user after each run (runs on pass or failure)
// -------------------------------------------------------------------
test.afterEach(async () => {
  if (seededEmail) {
    await deleteUserByEmail(seededEmail);
    seededEmail = undefined;
  }
});

// -------------------------------------------------------------------
// Forgot / reset password end-to-end flow
// -------------------------------------------------------------------
test("a user can reset their password via the forgot-password flow", async ({ page, request }) => {
  const email = `e2e-reset-${Date.now()}@example.com`;
  seededEmail = email;
  const oldPassword = "OldPassw0rd1";
  const newPassword = "NewPassw0rd1";

  // -----------------------------------------------------------------
  // Seed a throwaway user so we never touch real accounts
  // -----------------------------------------------------------------
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    // role is an input:false field - Better Auth rejects it in the sign-up
    // body, and a new account is a member either way.
    data: { name: "E2E Reset", email, password: oldPassword },
  });
  expect(signUp.ok(), "failed to seed test user").toBeTruthy();

  // -----------------------------------------------------------------
  // Request a password reset
  // -----------------------------------------------------------------
  await page.goto("/forgot-password");
  await fillAndSubmit(page.getByRole("button", { name: /send reset link/i }), async () => {
    await page.getByLabel("Email").fill(email);
  });
  // The message renders in both a toast and inline text - match either
  await expect(page.getByText(/a reset link has been sent/i).first()).toBeVisible();

  // -----------------------------------------------------------------
  // Pull the reset token from the DB (email is not delivered in tests)
  // -----------------------------------------------------------------
  const token = await getLatestResetToken(email);
  expect(token, "expected a reset token in the verifications table").toBeTruthy();

  // -----------------------------------------------------------------
  // Complete the reset
  // -----------------------------------------------------------------
  await page.goto(`/reset-password?token=${token}`);
  await fillAndSubmit(page.getByRole("button", { name: /reset password/i }), async () => {
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  });
  await expect(page.getByText(/your password has been reset/i)).toBeVisible({ timeout: 10000 });

  // -----------------------------------------------------------------
  // The new password should now work - sign in through the real UI
  // -----------------------------------------------------------------
  await page.goto("/sign-in");
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
  });
  // Landing in their own area is what proves the new password was accepted.
  await expect(page).toHaveURL(/\/portal\/?$/);
});
