import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/test";

import { getTeamRoleForUser, getUserIdByEmail, getUserInvitationStatusById, getUserRoleByEmail } from "./helpers/db";
import { SEED_PASSWORD, Seeder } from "./helpers/seed";
import { readEnvVar } from "./helpers/env";
import { fillAndSubmit } from "./helpers/sign-in";

// Better Auth rejects state-changing requests without an Origin header (CSRF
// protection). A real browser always sends one; Playwright's request client
// does not, so we set it explicitly to the app's origin (read from .env).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// Server actions (validate + sign up) can be slow on a cold server.
const ACTION_TIMEOUT = 20_000;

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so a test that seeds nothing cannot leave the previous test's
  // seeder in place, where cleaning it up a second time would look like a
  // clean-up that ran.
  seeder = undefined;
});

// -------------------------------------------------------------------
// Accepting an invitation
//
// This is the only path that creates an account, and the only one that can
// grant a role above 'member' or place somebody into a team. Everything it
// grants comes from the stored invitation row - so these tests check the
// STORED result (role, team membership), not what the page said.
// -------------------------------------------------------------------
test("an invited user can set a password and complete sign up", async ({ page, request }) => {
  seeder = new Seeder(request);

  const inviter = await seeder.user({ name: "E2E Inviter" });
  // Claimed before the flow runs: accepting is what creates the account, so if
  // this test fails after that point the row still has to be collected.
  const inviteeEmail = seeder.claimEmail(`e2e-invitee-${randomBytes(6).toString("hex")}@example.com`);
  const inviteToken = await seeder.invitation({ inviter, email: inviteeEmail, name: "E2E Invitee" });

  // -----------------------------------------------------------------
  // Open the invite link; the token is validated before the form shows
  // -----------------------------------------------------------------
  await page.goto(`/accept-invite/${inviteToken}`);
  // The invite page greets the user by name ("Welcome <name>") once the token
  // is validated - it doesn't render the email - so assert the greeting shows.
  await expect(page.getByRole("heading", { name: /welcome e2e invitee/i })).toBeVisible({ timeout: ACTION_TIMEOUT });

  // -----------------------------------------------------------------
  // Set a password to complete sign up
  // -----------------------------------------------------------------
  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByLabel("Confirm Password", { exact: true }).fill(SEED_PASSWORD);
  });
  // Accepting signs them in and lands them in their role's area, which is
  // the durable signal that the account was created - the toast races the
  // redirect it fires alongside.
  await expect(page).toHaveURL(/\/portal\/?$/, { timeout: ACTION_TIMEOUT });

  // -----------------------------------------------------------------
  // The invitee can now sign in with the password they set...
  //
  // Retried, because this is a real socket to a server that has just finished
  // creating the account. A keep-alive connection the server chooses to close
  // surfaces here as ECONNRESET - a thrown transport error, not a rejected
  // credential - and a single attempt cannot tell those apart. Retrying does:
  // a wrong password fails every attempt, a dead socket succeeds on the next.
  // -----------------------------------------------------------------
  await expect
    .poll(
      async () => {
        try {
          const signIn = await request.post("/api/auth/sign-in/email", {
            headers: { Origin: ORIGIN },
            data: { email: inviteeEmail, password: SEED_PASSWORD },
          });

          return signIn.ok();
        } catch {
          return false;
        }
      },
      { message: "invitee should be able to sign in with the password they set" },
    )
    .toBe(true);

  // ...as a member, which is what the invitation said...
  expect(await getUserRoleByEmail(inviteeEmail)).toBe("member");

  // ...and the invitation is marked completed so it can't be reused
  expect(await getUserInvitationStatusById(inviteToken)).toBe("completed");
});

// -------------------------------------------------------------------
// Team placement comes off the invitation row an admin created, never off the
// request. Accepting is what applies it - and membership is the app's security
// boundary, so it is worth reading back from the database rather than trusting
// that the flow said it worked.
// -------------------------------------------------------------------
test("an invitation carrying a team places the new account in that team", async ({ page, request }) => {
  seeder = new Seeder(request);

  const inviter = await seeder.user({ name: "E2E Inviter" });
  const team = await seeder.team({ name: seeder.label("E2E Invited Team") });
  const inviteeEmail = seeder.claimEmail(`e2e-team-invitee-${randomBytes(6).toString("hex")}@example.com`);
  const inviteToken = await seeder.invitation({
    inviter,
    email: inviteeEmail,
    name: "E2E Team Invitee",
    team,
    teamRole: "member",
  });

  await page.goto(`/accept-invite/${inviteToken}`);
  await expect(page.getByRole("heading", { name: /welcome e2e team invitee/i })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });

  await fillAndSubmit(page.getByRole("button", { name: /^login$/i }), async () => {
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByLabel("Confirm Password", { exact: true }).fill(SEED_PASSWORD);
  });
  // Accepting signs them in and lands them in their role's area, which is
  // the durable signal that the account was created - the toast races the
  // redirect it fires alongside.
  await expect(page).toHaveURL(/\/portal\/?$/, { timeout: ACTION_TIMEOUT });

  const inviteeId = await getUserIdByEmail(inviteeEmail);
  expect(inviteeId, "expected the invitee account to exist").toBeTruthy();

  // In the team, and in it as an ordinary member - not as a manager of it.
  expect(await getTeamRoleForUser(team.id, inviteeId as string)).toBe("member");

  // Team membership is a grant inside one team. It does not widen the platform
  // role, which the invitation set to 'member'.
  expect(await getUserRoleByEmail(inviteeEmail)).toBe("member");
});

// No seeder here: a token that was never issued has no rows behind it, so
// there is nothing to create and nothing to clean up.
test("an invalid invitation token shows an invalid-invitation message", async ({ page }) => {
  // A well-formed token that was never issued.
  const inviteToken = randomBytes(24).toString("hex");

  await page.goto(`/accept-invite/${inviteToken}`);

  await expect(page.getByRole("heading", { name: /invalid invitation/i })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });
});
