import { test, expect } from "./helpers/test";

import { getNotificationReadAt } from "./helpers/db";
import { Seeder } from "./helpers/seed";
import { signInAs } from "./helpers/sign-in";

// -------------------------------------------------------------------
// Member notifications
//
// A notification arrives unread, and read_at being NULL is the whole
// definition of that - it is what the unread count and the "New" marker are
// derived from. Opening a message sets it, and only for the message opened.
//
// The inbox marks as read on click, not on load: the first message is selected
// when the page renders, so a test that assumed otherwise would be asserting
// that opening one marks it read while actually watching the page mark it read
// by itself.
// -------------------------------------------------------------------

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so the next test cannot appear to clean up by running this one's
  // seeder a second time.
  seeder = undefined;
});

test("a notification arrives unread and opening it marks only that one read", async ({ page, request }) => {
  seeder = new Seeder(request);

  const member = await seeder.user();
  const firstTitle = seeder.label("E2E Pool Closure");
  const secondTitle = seeder.label("E2E Timetable Update");

  const firstId = await seeder.notification(member, { title: firstTitle });
  const secondId = await seeder.notification(member, { title: secondTitle });

  await signInAs(page, member);
  await page.goto("/portal/notifications");

  // Both arrived unread, and neither is read simply by the page rendering.
  await expect(page.getByRole("heading", { name: /2 unread/i })).toBeVisible();
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(2);
  expect(await getNotificationReadAt(firstId)).toBeNull();
  expect(await getNotificationReadAt(secondId)).toBeNull();

  // Open one of them.
  await page.getByRole("button", { name: new RegExp(secondTitle) }).click();

  // Its body opens, and the count drops by exactly one.
  await expect(page.getByRole("heading", { name: secondTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: /1 unread/i })).toBeVisible();

  // Marking read is fire-and-forget from the client, so the stored value is
  // polled rather than read once.
  await expect.poll(() => getNotificationReadAt(secondId)).not.toBeNull();
  // The one that was not opened is untouched.
  expect(await getNotificationReadAt(firstId)).toBeNull();

  // Open the other and the inbox is clear, on the page and in the database.
  await page.getByRole("button", { name: new RegExp(firstTitle) }).click();
  await expect(page.getByText(/all caught up/i)).toBeVisible();
  await expect.poll(() => getNotificationReadAt(firstId)).not.toBeNull();

  // A reload proves it was the server that recorded it, not just local state.
  await page.reload();
  await expect(page.getByText(/all caught up/i)).toBeVisible();
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(0);
});

test("an already-read notification does not count towards the unread total", async ({ page, request }) => {
  seeder = new Seeder(request);

  const member = await seeder.user();
  await seeder.notification(member, { title: seeder.label("E2E Old News"), readAt: new Date() });
  const unreadTitle = seeder.label("E2E Fresh News");
  await seeder.notification(member, { title: unreadTitle });

  await signInAs(page, member);
  await page.goto("/portal/notifications");

  await expect(page.getByRole("heading", { name: /1 unread/i })).toBeVisible();
  // Exactly one "New" marker, against the message that is actually new.
  await expect(page.getByRole("img", { name: "Unread" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(unreadTitle) })).toBeVisible();
});
