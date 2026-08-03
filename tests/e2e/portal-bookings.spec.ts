import type { Page } from "@playwright/test";

import { test, expect } from "./helpers/test";

import { getAttendanceStatus } from "./helpers/db";
import { appDateOffsetBy, Seeder } from "./helpers/seed";
import { signInAs } from "./helpers/sign-in";

// -------------------------------------------------------------------
// Member bookings
//
// A member may give up a place they hold on an upcoming session. That is the
// whole feature: the row is UPDATED to 'cancelled' rather than deleted, so
// staff still see who dropped out and the place frees up for somebody else.
//
// The interesting half is what they may NOT do. The attendee id travels back
// to the server in the cancel request, so it is untrusted input: what
// authorises the write is that the resolved row's user_id matches the SESSION,
// never the id itself. The second test tampers with that id in flight, which
// is the only way to check the guard rather than the button.
// -------------------------------------------------------------------

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so the next test cannot appear to clean up by running this one's
  // seeder a second time.
  seeder = undefined;
});

// Confirm the cancellation in the dialog. The list button and the dialog's
// confirm button share a label, so this is scoped to the dialog.
async function confirmCancel(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /cancel place/i }).click();
}

test("a member can cancel their own place on an upcoming session", async ({ page, request }) => {
  seeder = new Seeder(request);

  const member = await seeder.user();
  const team = await seeder.team();
  await seeder.addToTeam(team, member);

  const seededClass = await seeder.class({ team, name: seeder.label("E2E Monday Class") });
  const classSession = await seeder.classSession(seededClass, { date: appDateOffsetBy(3) });
  await seeder.joinClass(seededClass, member);
  const attendeeId = await seeder.booking(classSession, member);

  await signInAs(page, member);
  await page.goto("/portal/bookings");

  // The page's own h1. "Your bookings" above the list is a CardTitle, which
  // renders as a div and has no heading role - asking for it by role matches
  // nothing however long you wait.
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
  await expect(page.getByText(seededClass.name)).toBeVisible();

  await page.getByRole("button", { name: /cancel place/i }).click();
  await confirmCancel(page);

  await expect(page.getByText(/booking cancelled/i).first()).toBeVisible();

  // The stored state is what counts, and the row survives as a record of the
  // cancellation rather than disappearing.
  await expect.poll(() => getAttendanceStatus(attendeeId)).toBe("cancelled");

  // The place has moved to the "Cancelled" list, so the member can see it went
  // through and is not left wondering - and the control to give it up again is
  // gone, which is the part they would notice.
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /cancel place/i })).toHaveCount(0);
});

test("a member cannot cancel somebody else's place, even with their booking id", async ({ page, request }) => {
  seeder = new Seeder(request);

  const member = await seeder.user({ name: "E2E Booking Owner" });
  const otherMember = await seeder.user({ name: "E2E Other Member" });
  const team = await seeder.team();
  await seeder.addToTeam(team, member);
  await seeder.addToTeam(team, otherMember);

  // Both hold a place on the SAME session, so the only thing separating the two
  // rows is whose they are.
  const seededClass = await seeder.class({ team, name: seeder.label("E2E Shared Class") });
  const classSession = await seeder.classSession(seededClass, { date: appDateOffsetBy(3) });
  await seeder.joinClass(seededClass, member);
  await seeder.joinClass(seededClass, otherMember);
  const ownAttendeeId = await seeder.booking(classSession, member);
  const victimAttendeeId = await seeder.booking(classSession, otherMember);

  await signInAs(page, member);
  await page.goto("/portal/bookings");

  // The list is already scoped to their own places: one booking, one control.
  await expect(page.getByRole("button", { name: /cancel place/i })).toHaveCount(1);

  // Swap the attendee id in the cancel request for the other member's, which is
  // exactly the request a tampered client would send. Everything else about the
  // call is genuine - same session, same action, same page.
  let tampered = false;
  await page.route(
    (url) => url.pathname === "/portal/bookings",
    async (route) => {
      const body = route.request().method() === "POST" ? route.request().postData() : null;

      if (!body || !body.includes(ownAttendeeId)) {
        await route.continue();
        return;
      }

      tampered = true;
      await route.continue({ postData: body.replace(ownAttendeeId, victimAttendeeId) });
    },
  );

  await page.getByRole("button", { name: /cancel place/i }).click();
  await confirmCancel(page);

  // Refused - and refused with the same message it gives for an id that does
  // not exist, so the reply does not confirm that the booking is real.
  await expect(page.getByText(/could not find that booking/i).first()).toBeVisible();

  // If the swap never happened the assertion above would pass for the wrong
  // reason, so prove the request really did carry the other member's id.
  expect(tampered, "the cancel request should have been rewritten").toBe(true);

  // Nothing moved: not the other member's place, and not their own either.
  expect(await getAttendanceStatus(victimAttendeeId)).toBe("booked");
  expect(await getAttendanceStatus(ownAttendeeId)).toBe("booked");
});

test("a place on a session that is not going ahead offers no cancel control", async ({ page, request }) => {
  seeder = new Seeder(request);

  const member = await seeder.user();
  const seededClass = await seeder.class({ name: seeder.label("E2E Called Off Class") });
  // The session itself is off. The member still holds a booked place on it, but
  // there is nothing left to give up.
  const classSession = await seeder.classSession(seededClass, {
    date: appDateOffsetBy(4),
    status: "cancelled",
  });
  await seeder.joinClass(seededClass, member);
  await seeder.booking(classSession, member);

  await signInAs(page, member);
  await page.goto("/portal/bookings");

  await expect(page.getByText(seededClass.name)).toBeVisible();
  await expect(page.getByRole("button", { name: /cancel place/i })).toHaveCount(0);
});
