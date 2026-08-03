import { test, expect } from "./helpers/test";
import { deleteUserByEmail, withClient } from "./helpers/db";
import { readEnvVar } from "./helpers/env";
import { SEED_PASSWORD } from "./helpers/seed";
import { fillAndSubmit } from "./helpers/sign-in";

// Better Auth rejects state-changing requests without an Origin header (CSRF
// protection). A real browser always sends one; Playwright's request client
// does not, so we set it explicitly to the app's origin (read from .env).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Track the throwaway users each run seeds so they can be removed afterwards
const emailsToCleanup: string[] = [];

// -------------------------------------------------------------------
// Seed a throwaway user via the sign-up API (email is never delivered)
// -------------------------------------------------------------------
async function seedUser(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
) {
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    // role is an input:false field - Better Auth rejects it in the sign-up
    // body, and a new account is a member either way.
    data: { name: "E2E Sign In", email, password },
  });
  expect(signUp.ok(), "failed to seed test user").toBeTruthy();
}

// -------------------------------------------------------------------
// Clean up the seeded users after each run (runs on pass or failure)
// -------------------------------------------------------------------
test.afterEach(async () => {
  while (emailsToCleanup.length) {
    await deleteUserByEmail(emailsToCleanup.pop() as string);
  }
});

// -------------------------------------------------------------------
// Sign in (login page) end-to-end flow
// -------------------------------------------------------------------
test("a member with valid credentials signs in and lands in their portal", async ({ page, request }) => {
  const email = `e2e-sign-in-${Date.now()}@example.com`;
  emailsToCleanup.push(email);

  await seedUser(request, email, SEED_PASSWORD);

  // -----------------------------------------------------------------
  // Sign in through the real UI
  // -----------------------------------------------------------------
  await page.goto("/sign-in");
  // Filled through the shared helper, which retries until the form is actually
  // live. Typing straight into a page that has not hydrated yet loses the
  // values, and the login that follows fails in a way that looks like the
  // server rejecting good credentials.
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  });

  // Sign-in lands each role directly in its own area rather than bouncing
  // through a shared page. A new account is a member, so that is the portal.
  //
  // Reaching an authenticated page is what proves the credentials were
  // accepted. The success toast is not something to wait on: it fires and the
  // redirect it triggers is already under way, so asserting on it is a race.
  await expect(page).toHaveURL(/\/portal\/?$/);
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
});

test("signing in with the wrong password is rejected", async ({ page, request }) => {
  const email = `e2e-sign-in-wrong-${Date.now()}@example.com`;
  emailsToCleanup.push(email);

  await seedUser(request, email, SEED_PASSWORD);

  // -----------------------------------------------------------------
  // Submit with an incorrect password
  // -----------------------------------------------------------------
  await page.goto("/sign-in");
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("WrongPassw0rd12345");
  });

  // Invalid credentials surface as an error toast, and the user stays on sign-in
  await expect(page.getByText(/invalid credentials/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a deactivated account cannot sign in", async ({ page, request }) => {
  const email = `e2e-sign-in-inactive-${Date.now()}@example.com`;
  emailsToCleanup.push(email);

  await seedUser(request, email, SEED_PASSWORD);

  // is_active is server-assigned (input:false), so it is set the way admin
  // maintenance would set it - never through the account itself.
  await withClient((client) => client.query("UPDATE users SET is_active = FALSE WHERE email = $1", [email]));

  await page.goto("/sign-in");
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  });

  // No session is created, so they stay on sign-in and are told why.
  await expect(page.getByText(/deactivated/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});
