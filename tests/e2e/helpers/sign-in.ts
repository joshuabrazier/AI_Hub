import { expect, type Locator, type Page } from "@playwright/test";

import type { SeededUser } from "./seed";
import { generateTotp } from "./totp";

// A cold server can be slow on the first hit of a route, and the two-factor
// step is a full page navigation on top of a round trip.
const SIGN_IN_TIMEOUT = 30_000;

// -------------------------------------------------------------------
// Fill a form whose submit button stays disabled until the values are valid,
// then submit it.
//
// Every auth form in the app is React Hook Form: the button enables off form
// state, which only exists once the page has hydrated. Typing before that
// writes into markup that hydration then resets to the form's defaults - the
// fields look filled, the button never enables, and the test waits for a click
// that can never happen. So the fill is retried until the button goes live.
//
// Worth using for ANY of these forms, not just sign-in. A spec that fills and
// clicks in one go passes on a warm server and fails on a cold one, and when it
// fails it does so silently: the click lands on a form holding the values
// hydration reset it to, the submit is refused client-side, and the page simply
// stays put. That reads as the server rejecting good credentials.
// -------------------------------------------------------------------
export async function fillAndSubmit(
  submit: Locator,
  fill: () => Promise<void>,
  timeout = SIGN_IN_TIMEOUT,
): Promise<void> {
  await expect(async () => {
    await fill();
    await expect(submit).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout });

  await submit.click();
}

// -------------------------------------------------------------------
// Sign in through the real login form.
//
// A member gets a session straight away. A staff account does NOT: Better Auth
// only issues one at sign-in while two_factor_enabled is false, and every
// seeded staff account is enrolled (the proxy refuses /admin and /manage
// otherwise). So staff land on the two-factor challenge and the seeded TOTP
// secret is what completes it.
//
// This is the difference that looks like an authorization bug when it is not:
// a staff account that never completed the challenge simply has no session, so
// every internal route bounces it back to sign-in.
// -------------------------------------------------------------------
export async function signInAs(page: Page, user: SeededUser): Promise<void> {
  await page.goto("/sign-in");

  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
  });

  if (!user.totpSecret) {
    // Landing somewhere else is the durable proof that a session was issued.
    // The success toast is not: sign-in navigates straight to the role's home,
    // so waiting on the toast is a race against the redirect that caused it.
    await expect(page).not.toHaveURL(/\/sign-in/, { timeout: SIGN_IN_TIMEOUT });
    await expect(page).not.toHaveURL(/\/forbidden/, { timeout: SIGN_IN_TIMEOUT });
    return;
  }

  await expect(page).toHaveURL(/\/two-factor/, { timeout: SIGN_IN_TIMEOUT });

  // Generated at the moment of use: a code minted earlier could fall outside
  // its window while the challenge page was still loading.
  await fillAndSubmit(page.getByRole("button", { name: /^verify$/i }), async () => {
    await page.getByLabel(/authentication code/i).fill(generateTotp(user.totpSecret as string));
  });

  // Verifying hard-navigates so the proxy re-runs with the completed session
  // and routes the role to its own area.
  await expect(page).not.toHaveURL(/\/two-factor/, { timeout: SIGN_IN_TIMEOUT });
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: SIGN_IN_TIMEOUT });
  // A staff account that had somehow not enrolled would land here instead, and
  // that is worth failing loudly on rather than debugging as a scope problem.
  await expect(page).not.toHaveURL(/\/setup-2fa/, { timeout: SIGN_IN_TIMEOUT });
}
