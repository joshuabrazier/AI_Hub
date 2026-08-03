import { test, expect } from "./helpers/test";

import { Seeder } from "./helpers/seed";
import { signInAs } from "./helpers/sign-in";

// -------------------------------------------------------------------
// Area access
//
// Three areas, three roles: /admin for admins, /manage for managers, /portal
// for members. Asking for the wrong one does not show an error page - it
// redirects to the area the role does own, so nobody is left staring at a
// dead end.
//
// This is checked twice in the app (in the proxy and again in each area's
// layout) precisely so neither is load-bearing alone. These tests drive the
// real request, so they see whatever the pair of them actually does.
// -------------------------------------------------------------------

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so a test that seeds nothing cannot leave the previous test's
  // seeder in place, where cleaning it up a second time would look like a
  // clean-up that ran.
  seeder = undefined;
});

test("a member asking for the admin area lands in their own portal", async ({ page, request }) => {
  seeder = new Seeder(request);
  const member = await seeder.user();

  await signInAs(page, member);
  await page.goto("/admin/dashboard");

  await expect(page).toHaveURL(/\/portal\/?$/);
  // Landing in the portal, not merely bouncing off /admin.
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByText(/your portal/i).first()).toBeVisible();
});

test("a member asking for the manager area lands in their own portal", async ({ page, request }) => {
  seeder = new Seeder(request);
  const member = await seeder.user();

  await signInAs(page, member);
  await page.goto("/manage/teams");

  await expect(page).toHaveURL(/\/portal\/?$/);
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
});

test("a manager asking for the admin area lands in the manager area", async ({ page, request }) => {
  seeder = new Seeder(request);
  const manager = await seeder.user({ role: "manager" });

  await signInAs(page, manager);
  await page.goto("/admin/users");

  await expect(page).toHaveURL(/\/manage\/?$/);
  // The manager area labels itself, so this is not just "some page that is not
  // /admin/users" - it is the manager's own home.
  await expect(page.getByText("Manager").first()).toBeVisible();
});

// No seeder here: the whole point is that there is nobody signed in, so there
// is nothing to create and nothing to clean up.
test("a signed-out visitor is sent to sign in rather than into an area", async ({ page }) => {
  for (const area of ["/portal", "/manage", "/admin/dashboard"]) {
    await page.goto(area);
    await expect(page).toHaveURL(/\/sign-in/);
  }
});
