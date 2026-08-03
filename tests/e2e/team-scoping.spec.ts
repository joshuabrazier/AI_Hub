import { test, expect } from "./helpers/test";

import { newId, Seeder, type SeededTeam, type SeededUser } from "./helpers/seed";
import { signInAs } from "./helpers/sign-in";

// -------------------------------------------------------------------
// Team scoping
//
// The single most important behaviour in the app. A manager is assigned to
// teams by an admin, and everything they can read is resolved from that
// membership - looked up from their SESSION, never from the team id in the
// URL.
//
// Two properties are tested here, and they are different:
//
//   1. A team outside the scope returns NOTHING. Not a filtered-down view, not
//      an empty shell with the name still in it: the manager is not shown that
//      the team exists at all.
//
//   2. It answers NOT FOUND, identically to an id that was never issued. If it
//      said "forbidden" instead, the reply itself would confirm the team is
//      real, and the route would become a way to enumerate the other teams by
//      guessing. So the test asserts the two responses are the same response.
//
// And the case that is easy to get backwards: an EMPTY scope must return
// nothing, not everything. A manager assigned no teams is the exact input that
// turns a "filter by these ids" query into an unfiltered one.
// -------------------------------------------------------------------

type Scenario = {
  manager: SeededUser;
  teamA: SeededTeam;
  teamB: SeededTeam;
  memberA: SeededUser;
  memberB: SeededUser;
};

// Two teams that know nothing about each other, and a manager who holds
// exactly one of them.
//
// Takes the seeder rather than making one, so the rows it creates belong to a
// seeder afterEach can already see. Building one in here and handing it back
// at the end would mean anything that threw part-way left every row it had
// already inserted behind, with nothing holding the ids to remove them by.
async function seedTwoTeams(seeder: Seeder): Promise<Scenario> {
  const teamA = await seeder.team({ name: seeder.label("E2E Team Alpha") });
  const teamB = await seeder.team({ name: seeder.label("E2E Team Beta") });

  const manager = await seeder.user({ role: "manager" });
  await seeder.addToTeam(teamA, manager, "manager");

  const memberA = await seeder.user({ name: "E2E Alpha Member" });
  await seeder.addToTeam(teamA, memberA, "member");

  const memberB = await seeder.user({ name: "E2E Beta Member" });
  await seeder.addToTeam(teamB, memberB, "member");

  return { manager, teamA, teamB, memberA, memberB };
}

let seeder: Seeder | undefined;

test.afterEach(async () => {
  await seeder?.cleanup();
  // Cleared so the next test cannot appear to clean up by running this one's
  // seeder a second time.
  seeder = undefined;
});

test("a manager sees the team they hold and no trace of the one they do not", async ({ page, request }) => {
  seeder = new Seeder(request);
  const scenario = await seedTwoTeams(seeder);

  await signInAs(page, scenario.manager);

  // The landing view.
  await page.goto("/manage");
  await expect(page.getByText(scenario.teamA.name)).toBeVisible();
  await expect(page.getByText(scenario.teamB.name)).toHaveCount(0);

  // The full list.
  await page.goto("/manage/teams");
  await expect(page.getByText(scenario.teamA.name)).toBeVisible();
  await expect(page.getByText(scenario.teamB.name)).toHaveCount(0);

  // And inside the team they do hold: their own team's people, nobody else's.
  await page.goto(`/manage/teams/${scenario.teamA.id}`);
  await expect(page.getByRole("heading", { name: scenario.teamA.name })).toBeVisible();
  await expect(page.getByText(scenario.memberA.email)).toBeVisible();
  await expect(page.getByText(scenario.memberB.email)).toHaveCount(0);
});

test("a team outside a manager's scope is answered exactly like one that does not exist", async ({
  page,
  request,
}) => {
  seeder = new Seeder(request);
  const scenario = await seedTwoTeams(seeder);

  await signInAs(page, scenario.manager);

  // A real team the manager does not hold.
  const outOfScope = await page.goto(`/manage/teams/${scenario.teamB.id}`);
  await expect(page.getByText(/page not found/i)).toBeVisible();
  // Nothing about the team leaks into the response - not the name, and not an
  // "access denied" that would confirm there is something there to be denied.
  await expect(page.getByText(scenario.teamB.name)).toHaveCount(0);
  await expect(page.getByText(/access denied/i)).toHaveCount(0);

  // An id that was never issued, for comparison.
  const neverIssued = await page.goto(`/manage/teams/${newId()}`);
  await expect(page.getByText(/page not found/i)).toBeVisible();

  // The two answers are the same answer, which is the whole point: a guessed id
  // tells the guesser nothing about whether they guessed a real team.
  //
  // Compared to each other rather than to a literal 404 on purpose. The page
  // streams, so notFound() is thrown after the response has already been
  // committed and the status stays 200 for both - what must not differ is one
  // saying "no such page" and the other admitting the team exists.
  expect(outOfScope?.status()).toBe(neverIssued?.status());
});

test("a manager assigned no teams gets nothing, not everything", async ({ page, request }) => {
  seeder = new Seeder(request);
  const scenario = await seedTwoTeams(seeder);

  // A second manager, deliberately assigned to no team at all. An empty scope
  // is the input that turns "filter by these ids" into "no filter" when the
  // empty case is not handled.
  const unassigned = await seeder.user({ role: "manager" });

  await signInAs(page, unassigned);

  await page.goto("/manage");
  await expect(page.getByText(/no teams yet/i)).toBeVisible();
  await expect(page.getByText(scenario.teamA.name)).toHaveCount(0);
  await expect(page.getByText(scenario.teamB.name)).toHaveCount(0);

  await page.goto("/manage/teams");
  await expect(page.getByText(/no teams yet/i)).toBeVisible();
  await expect(page.getByText(scenario.teamA.name)).toHaveCount(0);
  await expect(page.getByText(scenario.teamB.name)).toHaveCount(0);

  // And an empty scope does not become a skeleton key for a team asked for by
  // id either.
  await page.goto(`/manage/teams/${scenario.teamA.id}`);
  await expect(page.getByText(/page not found/i)).toBeVisible();
  await expect(page.getByText(scenario.teamA.name)).toHaveCount(0);
});
