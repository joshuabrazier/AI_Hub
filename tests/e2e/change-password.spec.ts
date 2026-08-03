import { test, expect } from "./helpers/test";
import { deleteUserByEmail } from "./helpers/db";
import { readEnvVar } from "./helpers/env";
import { fillAndSubmit } from "./helpers/sign-in";

// Better Auth rejects state-changing requests without an Origin header (CSRF
// protection). A real browser always sends one; Playwright's request client
// does not, so we set it explicitly to the app's origin (read from .env).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Track the throwaway users each run seeds so they can be removed afterwards
const emailsToCleanup: string[] = [];

// -------------------------------------------------------------------
// Seed a throwaway signed-in user and land on the settings page
// -------------------------------------------------------------------
async function signInSeededUser(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
) {
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    // role is an input:false field - Better Auth rejects it in the sign-up
    // body, and a new account is a member either way.
    data: { name: "E2E Change Password", email, password },
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
// Change password (settings) end-to-end flow
// -------------------------------------------------------------------
test("a signed-in user can change their password", async ({ page, request }) => {
  const email = `e2e-change-pw-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  const oldPassword = "OldPassw0rd1";
  const newPassword = "NewPassw0rd1";

  await signInSeededUser(page, request, email, oldPassword);

  // -----------------------------------------------------------------
  // Change the password (the change-password section is shown by default)
  // -----------------------------------------------------------------
  await page.goto("/settings");
  // The nav and submit button share a label, so scope this to the form.
  await fillAndSubmit(
    page.locator("form").getByRole("button", { name: /change password/i }),
    async () => {
      await page.getByLabel("Current password", { exact: true }).fill(oldPassword);
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
    },
  );
  await expect(page.getByText(/password changed/i).first()).toBeVisible();

  // -----------------------------------------------------------------
  // The new password should work and the old one should not
  // -----------------------------------------------------------------
  const signInNew = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: newPassword },
  });
  expect(signInNew.ok(), "new password should be accepted").toBeTruthy();

  const signInOld = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: oldPassword },
  });
  expect(signInOld.ok(), "old password should be rejected").toBeFalsy();
});

test("changing password with the wrong current password is rejected", async ({ page, request }) => {
  const email = `e2e-change-pw-wrong-${Date.now()}@example.com`;
  emailsToCleanup.push(email);
  const password = "OldPassw0rd1";

  await signInSeededUser(page, request, email, password);

  // -----------------------------------------------------------------
  // Submit with an incorrect current password
  // -----------------------------------------------------------------
  await page.goto("/settings");
  await fillAndSubmit(
    page.locator("form").getByRole("button", { name: /change password/i }),
    async () => {
      await page.getByLabel("Current password", { exact: true }).fill("WrongPassw0rd1");
      await page.getByLabel("New password", { exact: true }).fill("NewPassw0rd1");
      await page.getByLabel("Confirm new password", { exact: true }).fill("NewPassw0rd1");
    },
  );
  await expect(page.getByText(/your current password is incorrect/i).first()).toBeVisible();

  // The password should be unchanged - the original still works
  const signInOld = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password },
  });
  expect(signInOld.ok(), "original password should still work").toBeTruthy();
});
