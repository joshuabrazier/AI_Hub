import { test, expect } from "./helpers/test";
import { deleteAnonymousSignOutsBetween, deleteUserByEmail } from "./helpers/db";
import { readEnvVar } from "./helpers/env";
import { SEED_PASSWORD } from "./helpers/seed";
import { fillAndSubmit } from "./helpers/sign-in";
import { buildChangeEmailVerificationToken } from "./helpers/verify-token";

// Better Auth rejects state-changing requests without an Origin header (CSRF
// protection). A real browser always sends one; Playwright's request client
// does not, so we set it explicitly to the app's origin (read from .env).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Track the throwaway users each run seeds so they can be removed afterwards.
// The email changes mid-test, so we clean up every address we may have created.
const emailsToCleanup: string[] = [];

// The window around the sign-out this flow fires with an already-revoked
// session. That sign-out is audited with nobody's name on it, so the instants
// either side of the request are the only handle cleanup has on the row.
let anonymousSignOut: { from: Date; to: Date } | undefined;

// -------------------------------------------------------------------
// Seed a throwaway signed-in user, then open the change-email section
// -------------------------------------------------------------------
async function signInSeededUserAndOpenChangeEmail(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
) {
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    // role is an input:false field - Better Auth rejects it in the sign-up
    // body, and a new account is a member either way.
    data: { name: "E2E Tester", email, password },
  });
  expect(signUp.ok(), "failed to seed test user").toBeTruthy();

  await page.goto("/sign-in");
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
  });
  // Reaching an authenticated page is the durable proof a session was
  // issued. The success toast races the redirect that follows it.
  await expect(page).not.toHaveURL(/\/sign-in/);

  await page.goto("/settings");
  // The settings section nav labels the email section "Email"; exact match so
  // we hit that nav button, not e.g. the account-menu trigger.
  await page.getByRole("button", { name: "Email", exact: true }).click();
}

// -------------------------------------------------------------------
// Clean up the seeded users after each run (runs on pass or failure)
// -------------------------------------------------------------------
test.afterEach(async () => {
  while (emailsToCleanup.length) {
    await deleteUserByEmail(emailsToCleanup.pop() as string);
  }

  if (anonymousSignOut) {
    await deleteAnonymousSignOutsBetween(anonymousSignOut.from, anonymousSignOut.to);
    anonymousSignOut = undefined;
  }
});

// -------------------------------------------------------------------
// Change email (settings) end-to-end flow
// -------------------------------------------------------------------
test("a signed-in user can change their email and is signed out to sign in again", async ({ page, request }) => {
  const currentEmail = `e2e-change-email-${Date.now()}@example.com`;
  const newEmail = `e2e-change-email-new-${Date.now()}@example.com`;
  emailsToCleanup.push(currentEmail, newEmail);

  await signInSeededUserAndOpenChangeEmail(page, request, currentEmail, SEED_PASSWORD);

  // -----------------------------------------------------------------
  // Request the change (re-authenticates with the current password)
  // -----------------------------------------------------------------
  // The nav and submit button share a label, so scope this to the form.
  await fillAndSubmit(page.locator("form").getByRole("button", { name: /change email/i }), async () => {
    await page.getByLabel("Current password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByLabel("New email", { exact: true }).fill(newEmail);
    await page.getByLabel("Confirm new email", { exact: true }).fill(newEmail);
  });
  await expect(page.getByText(/check your new email to confirm the change/i).first()).toBeVisible();

  // -----------------------------------------------------------------
  // Follow the verification link (the token is a stateless JWT that is
  // only emailed, so we rebuild the exact link Better Auth would send).
  // -----------------------------------------------------------------
  const token = buildChangeEmailVerificationToken(currentEmail, newEmail);
  const callbackURL = encodeURIComponent("/sign-in?email-changed=true");
  // The landing page clears the lingering session cookie on load - capture it
  const signedOut = page.waitForResponse((response) => response.url().includes("/api/auth/sign-out"));
  // Taken before the navigation that causes the sign-out, so the audit row it
  // writes cannot land before the window opens.
  const signOutFrom = new Date();
  await page.goto(`/api/auth/verify-email?token=${token}&callbackURL=${callbackURL}`);

  // The user lands back on sign-in with a confirmation the email changed
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText(/your email has been changed/i)).toBeVisible();

  // -----------------------------------------------------------------
  // Sessions are revoked on email change - the old session no longer
  // grants access to a protected page
  // -----------------------------------------------------------------
  await signedOut;
  // Closed once the response is in hand. The audit row is written before that
  // response is returned, so it is inside the window - and the window is over
  // in the time one request took.
  anonymousSignOut = { from: signOutFrom, to: new Date() };

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);

  // -----------------------------------------------------------------
  // The new email works and the old one no longer does
  // -----------------------------------------------------------------
  const signInNew = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email: newEmail, password: SEED_PASSWORD },
  });
  expect(signInNew.ok(), "new email should be accepted").toBeTruthy();

  const signInOld = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email: currentEmail, password: SEED_PASSWORD },
  });
  expect(signInOld.ok(), "old email should be rejected").toBeFalsy();
});

test("changing email with the wrong current password is rejected", async ({ page, request }) => {
  const currentEmail = `e2e-change-email-wrong-${Date.now()}@example.com`;
  const newEmail = `e2e-change-email-wrong-new-${Date.now()}@example.com`;
  emailsToCleanup.push(currentEmail, newEmail);

  await signInSeededUserAndOpenChangeEmail(page, request, currentEmail, SEED_PASSWORD);

  // -----------------------------------------------------------------
  // Submit with an incorrect current password
  // -----------------------------------------------------------------
  // Through the shared helper like every other submission in the suite: a
  // click that lands before the form has hydrated is refused client-side and
  // the page simply stays put, which here would read as the app failing to
  // reject a wrong password rather than as the test being too early.
  await fillAndSubmit(page.locator("form").getByRole("button", { name: /change email/i }), async () => {
    await page.getByLabel("Current password", { exact: true }).fill("WrongPassw0rd12345");
    await page.getByLabel("New email", { exact: true }).fill(newEmail);
    await page.getByLabel("Confirm new email", { exact: true }).fill(newEmail);
  });
  await expect(page.getByText(/your current password is incorrect/i).first()).toBeVisible();

  // The email should be unchanged - the original still works, the new one does not exist
  const signInOld = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email: currentEmail, password: SEED_PASSWORD },
  });
  expect(signInOld.ok(), "original email should still work").toBeTruthy();
});
