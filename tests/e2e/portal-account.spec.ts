import { test, expect } from "./helpers/test";

import { getUserProfileById } from "./helpers/db";
import { Seeder } from "./helpers/seed";
import { fillAndSubmit, signInAs } from "./helpers/sign-in";

// -------------------------------------------------------------------
// Member account
//
// The portal carries no id in its path: /portal/account is whoever is signed
// in, resolved from the session on the server. This replaced /client/[clientId]
// precisely so there is no id in the URL to tamper with and nothing to compare
// one against on every request.
//
// So the test asserts two things - that a member can edit their own details,
// and that their own id appears nowhere in the address that let them.
// -------------------------------------------------------------------

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so the next test cannot appear to clean up by running this one's
  // seeder a second time.
  seeder = undefined;
});

test("a member can update their own details and it persists", async ({ page, request }) => {
  seeder = new Seeder(request);
  const member = await seeder.user({ name: "E2E Account Holder" });

  await signInAs(page, member);
  await page.goto("/portal/account");

  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

  await fillAndSubmit(page.getByRole("button", { name: /save changes/i }), async () => {
    await page.getByLabel("Preferred name").fill("Jo");
    await page.getByLabel("Phone number").fill("0411222333");
  });

  await expect(page.getByText(/details updated/i).first()).toBeVisible();

  // Written against the signed-in account, which is the only one the request
  // could have named.
  await expect
    .poll(async () => (await getUserProfileById(member.id))?.phoneNumber)
    .toBe("0411222333");
  const profile = await getUserProfileById(member.id);
  expect(profile?.preferredName).toBe("Jo");
  expect(profile?.name).toBe("E2E Account Holder");

  // The address that did it names nobody.
  expect(page.url()).toContain("/portal/account");
  expect(page.url()).not.toContain(member.id);
});

test("one member's edits do not touch another's account", async ({ page, request }) => {
  seeder = new Seeder(request);
  const member = await seeder.user({ name: "E2E Editing Member" });
  const otherMember = await seeder.user({ name: "E2E Untouched Member" });

  await signInAs(page, member);
  await page.goto("/portal/account");

  await fillAndSubmit(page.getByRole("button", { name: /save changes/i }), async () => {
    await page.getByLabel("Phone number").fill("0400111222");
  });
  await expect(page.getByText(/details updated/i).first()).toBeVisible();

  await expect.poll(async () => (await getUserProfileById(member.id))?.phoneNumber).toBe("0400111222");

  // There is no request shape that could have reached the other account - the
  // update carries no user id at all - and the stored row says so.
  const untouched = await getUserProfileById(otherMember.id);
  expect(untouched?.phoneNumber).toBeNull();
  expect(untouched?.name).toBe("E2E Untouched Member");
});
