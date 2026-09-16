import { describe, expect, it } from "vitest";

import { USER_ROLES } from "@/lib/data/kysely-database-types";

import { isCollapsible, navGroupsForRole, withMyProjects, type NavProject } from "./nav-items";

// -------------------------------------------------------------------
// The projects entry in the sidebar.
//
// ONE ROW, AND THAT IS THE POINT OF MOST OF THIS FILE. The rail used to carry
// a link called "All projects", then a heading reading "Projects", then a
// disclosure also reading "Projects" - three rows over ONE list, because
// /{area}/projects shows the projects you are a member of, which is exactly
// what fills the children here. "All" named a fuller list that does not exist
// anywhere in the app.
//
// The rest is things that do not show up as a broken page: a link that goes
// to the wrong AREA, which the proxy quietly redirects rather than refusing so
// nobody sees an error; and an entry that starts SHUT, which hides the
// projects on every screen except the ones already inside it.
// -------------------------------------------------------------------
const projects: NavProject[] = [
  { id: "p1", title: "Data platform", clientName: "Perks" },
  { id: "p2", title: "Website", clientName: "Ardent" },
];

type Role = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * The Projects entry for a role, with the given projects hung under it.
 *
 * Goes through the real tree rather than a fabricated one, because the entry
 * living in the STATIC tree is half of what is being asserted - it is what
 * stops a row appearing above "Your timesheet" a moment after the sidebar
 * paints, and what leaves somebody on no projects a way to the page.
 */
function projectsEntry(role: Role, list: NavProject[]) {
  const groups = withMyProjects(navGroupsForRole(role), role, list);

  const entries = groups.flatMap((group) => group.items).filter((entry) => entry.label === "Projects");

  expect(entries, "exactly one row in the whole rail may be called Projects").toHaveLength(1);

  const entry = entries[0];

  expect(isCollapsible(entry), "the projects entry must be a collapsible").toBe(true);

  if (!isCollapsible(entry)) throw new Error("unreachable - asserted above");

  return entry;
}

describe("the projects entry", () => {
  it("IS the projects page as well as the list of them", () => {
    // The whole change. One row that navigates to /{area}/projects AND
    // expands into the projects themselves, replacing the link-above-a-
    // disclosure that showed the same set twice under two names.
    expect(projectsEntry(USER_ROLES.ADMIN, projects).href).toBe("/admin/projects");
    expect(projectsEntry(USER_ROLES.MANAGER, projects).href).toBe("/manage/projects");
    expect(projectsEntry(USER_ROLES.MEMBER, projects).href).toBe("/portal/projects");
  });

  it("STAYS when the person is on no projects", () => {
    // It used to be dropped, and relied on the "All projects" link beside it
    // to cover that case. With the link gone, vanishing would strand somebody
    // on no projects with no way to the page that says so.
    const entry = projectsEntry(USER_ROLES.MEMBER, []);

    expect(entry.children).toHaveLength(0);
    expect(entry.href).toBe("/portal/projects");
  });

  it("is a COLLAPSIBLE, so it can be shut", () => {
    expect(projectsEntry(USER_ROLES.MEMBER, projects).label).toBe("Projects");
  });

  it("starts OPEN, which is the whole reason it can be a collapsible at all", () => {
    // The sidebar's default is to open a group only when the current page is
    // already one of its children (`entry.defaultOpen ?? childActive`). For
    // these that would mean the projects were hidden on every screen where
    // seeing them is worth anything, which is a list nobody can navigate WITH.
    expect(projectsEntry(USER_ROLES.ADMIN, projects).defaultOpen).toBe(true);
  });

  it("gives one child per project, labelled with the project", () => {
    expect(projectsEntry(USER_ROLES.MEMBER, projects).children.map((child) => child.label)).toEqual([
      "Data platform",
      "Website",
    ]);
  });

  it("routes each link into the AREA the role belongs to", () => {
    // The proxy REDIRECTS a role that lands in the wrong area rather than
    // refusing it, so a hand-built /admin/... followed by a member is not an
    // error anybody sees - it is a link that quietly goes somewhere else.
    const hrefFor = (role: (typeof USER_ROLES)[keyof typeof USER_ROLES]) =>
      projectsEntry(role, projects).children[0].href;

    expect(hrefFor(USER_ROLES.ADMIN)).toBe("/admin/projects/p1");
    expect(hrefFor(USER_ROLES.MANAGER)).toBe("/manage/projects/p1");
    expect(hrefFor(USER_ROLES.MEMBER)).toBe("/portal/projects/p1");
  });

  it("names the CLIENT in the tooltip, because two projects can share a title", () => {
    // "Website" for two clients is the ordinary case, and the label alone
    // cannot tell them apart in a sidebar. The rail also shows this on hover,
    // since a long title is truncated to the width of the rail.
    expect(projectsEntry(USER_ROLES.MEMBER, projects).children[1]).toMatchObject({
      tooltip: "Website - Ardent",
    });
  });

  it("does not truncate the LIST, however long it is", () => {
    // The list is memberships only with archived excluded, so it is the
    // working set rather than everything. Hiding some of it would drop a
    // project with nothing on screen saying so. Long NAMES are truncated in
    // the rail, which is a different thing and is done in CSS.
    const many: NavProject[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      title: `Project ${i}`,
      clientName: "Perks",
    }));

    expect(projectsEntry(USER_ROLES.ADMIN, many).children).toHaveLength(12);
  });
});

// -------------------------------------------------------------------
// The AI group, which is the one part of the nav defined once and used by all
// three trees. That is what makes it worth asserting per role: a shared
// definition is exactly the thing that can be right in one area and wrong in
// another, because a route prefix is passed in rather than written down.
// -------------------------------------------------------------------
describe("the AI group", () => {
  const aiGroupFor = (role: (typeof USER_ROLES)[keyof typeof USER_ROLES]) => {
    const entry = navGroupsForRole(role)
      .flatMap((group) => group.items)
      .find((item) => item.label === "AI");

    expect(entry, `expected an AI group in the ${role} tree`).toBeDefined();
    expect(isCollapsible(entry!), "the AI group must be a collapsible").toBe(true);

    if (!entry || !isCollapsible(entry)) throw new Error("unreachable - asserted above");

    return entry;
  };

  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER])(
    "holds all three AI tools for %s",
    (role) => {
      // The chat's label is DERIVED from the assistant's name, so it is not
      // asserted as a literal - only that there are three, and which two of
      // them are fixed.
      const labels = aiGroupFor(role).children.map((child) => child.label);

      expect(labels).toHaveLength(3);
      expect(labels).toContain("Transcription");
      expect(labels).toContain("Summaries");
    },
  );

  it.each([
    [USER_ROLES.ADMIN, "/admin/"],
    [USER_ROLES.MANAGER, "/manage/"],
    [USER_ROLES.MEMBER, "/portal/"],
  ])("routes %s's AI tools into their own area", (role, prefix) => {
    // The builder takes its routes as an argument, so passing the wrong
    // area's is a mistake nothing else would catch - the proxy REDIRECTS a
    // role in the wrong area rather than refusing it, so it would look like
    // a link that quietly goes somewhere else.
    for (const child of aiGroupFor(role).children) {
      expect(child.href.startsWith(prefix), `${child.label} -> ${child.href}`).toBe(true);
    }
  });

  it("does NOT start open, unlike Projects", () => {
    // These are tools somebody reaches for now and then, so the sidebar's
    // ordinary rule applies: open when you are already inside it. Projects
    // are the day job and are the deliberate exception.
    expect(aiGroupFor(USER_ROLES.ADMIN).defaultOpen).toBeUndefined();
  });
});

// -------------------------------------------------------------------
// The account row.
//
// It is pinned to the bottom in every area, and the page behind it is one
// feature page mounted three times. The failure worth guarding is an href
// pointing into the WRONG area: the proxy redirects rather than refusing, so
// an admin sent to /portal/account lands silently on /admin having asked for
// their account - which is what used to happen, because there was no
// /admin/account at all.
// -------------------------------------------------------------------
describe("the account group", () => {
  const accountGroupFor = (role: (typeof USER_ROLES)[keyof typeof USER_ROLES]) => {
    const group = navGroupsForRole(role).find((item) => item.label === "Account");

    expect(group, `expected an Account group in the ${role} tree`).toBeDefined();

    return group!;
  };

  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER])(
    "exists for %s, because every role has an account",
    (role) => {
      expect(accountGroupFor(role).items).toHaveLength(1);
    },
  );

  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER])(
    "is pinned to the bottom for %s",
    (role) => {
      // `footer` is what puts it below the scrolling list rather than merely
      // last in it - see NavGroup.footer.
      expect(accountGroupFor(role).footer).toBe(true);
    },
  );

  it.each([
    [USER_ROLES.ADMIN, "/admin/account"],
    [USER_ROLES.MANAGER, "/manage/account"],
    [USER_ROLES.MEMBER, "/portal/account"],
  ])("sends %s to their own area's mount", (role, href) => {
    expect((accountGroupFor(role).items[0] as { href: string }).href).toBe(href);
  });

  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER])(
    "is LAST in %s's tree, so it is last when the tree is flattened",
    (role) => {
      // The mobile sheet and appKnowledgePrompt both flatten, and neither
      // reads `footer`. Being last in the array is what keeps those two
      // agreeing with the rail.
      const groups = navGroupsForRole(role);

      expect(groups[groups.length - 1].label).toBe("Account");
    },
  );
});

// -------------------------------------------------------------------
// Where the projects land in the ADMIN tree.
//
// useNavGroups splices them in after the group called "Delivery". That puts
// them above whatever group comes next, so "Delivery admin" being a separate
// group that follows Delivery is not tidiness - it is the entire mechanism
// by which the boards somebody opens all day sit above a disclosure of admin
// screens they open occasionally.
// -------------------------------------------------------------------
describe("the admin tree's delivery ordering", () => {
  it("has Delivery admin as its OWN group, immediately after Delivery", () => {
    const labels = navGroupsForRole(USER_ROLES.ADMIN).map((group) => group.label);
    const delivery = labels.indexOf("Delivery");

    expect(delivery, "expected a Delivery group").toBeGreaterThanOrEqual(0);
    expect(labels[delivery + 1]).toBe("Delivery admin");
  });

  it("does not leave Delivery admin inside the Delivery group", () => {
    // Nested, the admin disclosure would sit between the projects and the
    // timesheet - putting the boards somebody opens all day underneath a
    // group of screens they open occasionally.
    const delivery = navGroupsForRole(USER_ROLES.ADMIN).find((group) => group.label === "Delivery");

    expect(delivery?.items.map((item) => item.label)).toEqual(["Projects", "Your timesheet"]);
  });

  it("calls the reporting group Reports, not Timesheets", () => {
    // Two entries a few rows apart both called some version of "timesheet",
    // over two different data sets, was the confusion this rename settles -
    // "Your timesheet" is where hours are ENTERED, Reports is where logged
    // time is READ.
    const labels = navGroupsForRole(USER_ROLES.ADMIN)
      .flatMap((group) => group.items)
      .map((entry) => entry.label);

    expect(labels).toContain("Reports");
    expect(labels).not.toContain("Timesheets");
  });
});

// ===================================================================
// ONE WAY TO THE PROJECTS, NOT THREE.
//
// This is the regression guard for the thing that was actually wrong, and the
// history is worth keeping because the previous attempt made it worse. There
// were three rows - a link "All projects", a group heading "Projects", and a
// disclosure "Projects" - over ONE list. The test that used to live here
// checked the two ROWS were not given the same NAME, which treated the
// duplication as a naming collision rather than as a duplicate.
// ===================================================================
const ALL_ROLES = [USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER] as const;

describe("one way to the projects", () => {
  it.each(ALL_ROLES)("gives %s exactly one row that goes to the projects page", (role) => {
    const projectsPage = navGroupsForRole(role)
      .flatMap((group) => group.items)
      .filter((entry) => entry.href?.endsWith("/projects"));

    expect(projectsPage).toHaveLength(1);
    expect(projectsPage[0].label).toBe("Projects");
  });

  it.each(ALL_ROLES)("never labels a row 'All projects' for %s", (role) => {
    // It named a fuller list that does not exist: /{area}/projects shows the
    // projects you are a MEMBER of, the same set the disclosure listed.
    const labels = navGroupsForRole(role)
      .flatMap((group) => group.items)
      .map((entry) => entry.label);

    expect(labels).not.toContain("All projects");
  });

  it.each(ALL_ROLES)("has no separate Projects GROUP for %s to render a second heading", (role) => {
    // A group called "Projects" holding one disclosure called "Projects" put
    // the word on screen twice, one row above the other.
    expect(navGroupsForRole(role).filter((group) => group.label === "Projects")).toHaveLength(0);

    expect(
      withMyProjects(navGroupsForRole(role), role, projects).filter(
        (group) => group.label === "Projects",
      ),
    ).toHaveLength(0);
  });

  it.each(ALL_ROLES)("puts Projects FIRST in Delivery for %s", (role) => {
    // The property, rather than the whole list: the entry lives in the static
    // tree instead of arriving with the fetch, so it cannot appear a moment
    // after the sidebar paints and push what was under somebody's cursor
    // down. Asserting the exact contents made this break when managers gained
    // a row, which is a change to the tree and not to the thing being
    // protected.
    const delivery = navGroupsForRole(role).find((group) => group.label === "Delivery");

    expect(delivery?.items[0]?.label).toBe("Projects");
    expect(delivery?.items.at(-1)?.label).toBe("Your timesheet");
  });

  // -----------------------------------------------------------------
  // WHO IS OFFERED A WAY TO START ONE.
  //
  // Managers create projects and members do not, and the nav is the only
  // place that difference is visible - so it is the one place it can be got
  // wrong without anybody noticing until a member is staring at a form that
  // refuses them. The refusal is real either way: createProjectService
  // guards on [ADMIN, MANAGER].
  // -----------------------------------------------------------------
  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER])("offers %s a way to start a project", (role) => {
    const labels = navGroupsForRole(role)
      .flatMap((group) => group.items)
      .flatMap((entry) => (isCollapsible(entry) ? entry.children.map((c) => c.label) : [entry.label]));

    expect(labels).toContain("New project");
  });

  it("offers a MEMBER no way to start a project", () => {
    const labels = navGroupsForRole(USER_ROLES.MEMBER)
      .flatMap((group) => group.items)
      .flatMap((entry) => (isCollapsible(entry) ? entry.children.map((c) => c.label) : [entry.label]));

    expect(labels).not.toContain("New project");
  });
});
