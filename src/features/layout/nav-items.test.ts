import { describe, expect, it } from "vitest";

import { USER_ROLES } from "@/lib/data/kysely-database-types";

import { isCollapsible, navGroupsForRole, projectsNavGroup, type NavProject } from "./nav-items";

// -------------------------------------------------------------------
// The projects group in the sidebar.
//
// Three things are worth pinning and none shows up as a broken page: a link
// that goes to the wrong AREA, which the proxy quietly redirects rather than
// refusing so nobody sees an error; a group that renders with nothing in it,
// which is a heading promising something that is not there; and a group that
// starts SHUT, which hides the projects on every screen except the ones
// already inside it.
// -------------------------------------------------------------------
const projects: NavProject[] = [
  { id: "p1", title: "Data platform", clientName: "Perks" },
  { id: "p2", title: "Website", clientName: "Ardent" },
];

/**
 * The group holds exactly one entry - the collapsible - and the projects are
 * its children. Every test below goes through this rather than reaching into
 * `items[0]`, so the shape is asserted once.
 */
function collapsibleFrom(role: (typeof USER_ROLES)[keyof typeof USER_ROLES], list: NavProject[]) {
  const group = projectsNavGroup(role, list);

  expect(group, "expected a projects group").not.toBeNull();
  expect(group?.items, "the group holds the collapsible and nothing else").toHaveLength(1);

  const entry = group!.items[0];

  expect(isCollapsible(entry), "the projects entry must be a collapsible").toBe(true);

  if (!isCollapsible(entry)) throw new Error("unreachable - asserted above");

  return entry;
}

describe("projectsNavGroup", () => {
  it("is ABSENT when the person is on no projects", () => {
    // An empty heading is worse than no heading - it promises something that
    // is not there, and the "All projects" link already says so in words.
    expect(projectsNavGroup(USER_ROLES.MEMBER, [])).toBeNull();
  });

  it("is a COLLAPSIBLE, so it can be shut", () => {
    expect(collapsibleFrom(USER_ROLES.MEMBER, projects).label).toBe("Projects");
  });

  it("starts OPEN, which is the whole reason it can be a collapsible at all", () => {
    // The sidebar's default is to open a group only when the current page is
    // already one of its children (`entry.defaultOpen ?? childActive`). For
    // these that would mean the projects were hidden on every screen where
    // seeing them is worth anything, which is a list nobody can navigate WITH.
    expect(collapsibleFrom(USER_ROLES.ADMIN, projects).defaultOpen).toBe(true);
  });

  it("gives one child per project, labelled with the project", () => {
    expect(collapsibleFrom(USER_ROLES.MEMBER, projects).children.map((child) => child.label)).toEqual([
      "Data platform",
      "Website",
    ]);
  });

  it("routes each link into the AREA the role belongs to", () => {
    // The proxy REDIRECTS a role that lands in the wrong area rather than
    // refusing it, so a hand-built /admin/... followed by a member is not an
    // error anybody sees - it is a link that quietly goes somewhere else.
    const hrefFor = (role: (typeof USER_ROLES)[keyof typeof USER_ROLES]) =>
      collapsibleFrom(role, projects).children[0].href;

    expect(hrefFor(USER_ROLES.ADMIN)).toBe("/admin/projects/p1");
    expect(hrefFor(USER_ROLES.MANAGER)).toBe("/manage/projects/p1");
    expect(hrefFor(USER_ROLES.MEMBER)).toBe("/portal/projects/p1");
  });

  it("names the CLIENT in the tooltip, because two projects can share a title", () => {
    // "Website" for two clients is the ordinary case, and the label alone
    // cannot tell them apart in a sidebar. The rail also shows this on hover,
    // since a long title is truncated to the width of the rail.
    expect(collapsibleFrom(USER_ROLES.MEMBER, projects).children[1]).toMatchObject({
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

    expect(collapsibleFrom(USER_ROLES.ADMIN, many).children).toHaveLength(12);
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
    // If it were still nested, the splice would put the projects BELOW it,
    // which is the layout this replaced.
    const delivery = navGroupsForRole(USER_ROLES.ADMIN).find((group) => group.label === "Delivery");

    expect(delivery?.items.map((item) => item.label)).toEqual(["All projects", "Your timesheet"]);
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

// -------------------------------------------------------------------
// The static trees, asserted only where the projects group depends on them.
// -------------------------------------------------------------------
describe("the nav trees the projects group is spliced into", () => {
  it.each([USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER])(
    "gives %s a Delivery group to sit under",
    (role) => {
      // useNavGroups splices the projects group directly after Delivery, and
      // falls back to appending when there is none. This asserts the ordinary
      // path stays the ordinary path.
      expect(navGroupsForRole(role).some((group) => group.label === "Delivery")).toBe(true);
    },
  );

  it("has no group already called Projects, which would render twice", () => {
    for (const role of [USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER]) {
      expect(navGroupsForRole(role).filter((group) => group.label === "Projects")).toHaveLength(0);
    }
  });

  it("has no entry already labelled Projects in the rail either", () => {
    // The collapsible's own row is labelled "Projects", and the overflow link
    // beside it was renamed "All projects" for exactly this reason. Two rows
    // reading "Projects" one above the other is the failure this catches.
    for (const role of [USER_ROLES.ADMIN, USER_ROLES.MANAGER, USER_ROLES.MEMBER]) {
      const labels = navGroupsForRole(role)
        .flatMap((group) => group.items)
        .map((entry) => entry.label);

      expect(labels.filter((label) => label === "Projects")).toHaveLength(0);
    }
  });
});
