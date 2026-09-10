import { describe, expect, it } from "vitest";

import { USER_ROLES } from "@/lib/data/kysely-database-types";

import { navGroupsForRole, projectsNavGroup, type NavProject } from "./nav-items";

// -------------------------------------------------------------------
// The projects group in the sidebar.
//
// Two things are worth pinning and neither shows up as a broken page: a link
// that goes to the wrong AREA, which the proxy quietly redirects rather than
// refusing so nobody sees an error; and a group that renders with nothing in
// it, which is a heading promising something that is not there.
// -------------------------------------------------------------------
const projects: NavProject[] = [
  { id: "p1", title: "Data platform", clientName: "Perks" },
  { id: "p2", title: "Website", clientName: "Ardent" },
];

describe("projectsNavGroup", () => {
  it("is ABSENT when the person is on no projects", () => {
    // An empty heading is worse than no heading - it promises something that
    // is not there, and the "All projects" link already says so in words.
    expect(projectsNavGroup(USER_ROLES.MEMBER, [])).toBeNull();
  });

  it("gives one link per project, labelled with the project", () => {
    const group = projectsNavGroup(USER_ROLES.MEMBER, projects);

    expect(group?.label).toBe("Projects");
    expect(group?.items.map((item) => item.label)).toEqual(["Data platform", "Website"]);
  });

  it("routes each link into the AREA the role belongs to", () => {
    // The proxy REDIRECTS a role that lands in the wrong area rather than
    // refusing it, so a hand-built /admin/... followed by a member is not an
    // error anybody sees - it is a link that quietly goes somewhere else.
    const hrefFor = (role: (typeof USER_ROLES)[keyof typeof USER_ROLES]) =>
      (projectsNavGroup(role, projects)?.items[0] as { href: string }).href;

    expect(hrefFor(USER_ROLES.ADMIN)).toBe("/admin/projects/p1");
    expect(hrefFor(USER_ROLES.MANAGER)).toBe("/manage/projects/p1");
    expect(hrefFor(USER_ROLES.MEMBER)).toBe("/portal/projects/p1");
  });

  it("names the CLIENT in the tooltip, because two projects can share a title", () => {
    // "Website" for two clients is the ordinary case, and the label alone
    // cannot tell them apart in a sidebar.
    const group = projectsNavGroup(USER_ROLES.MEMBER, projects);

    expect(group?.items[1]).toMatchObject({ tooltip: "Website - Ardent" });
  });

  it("does not truncate", () => {
    // The list is memberships only with archived excluded, so it is the
    // working set rather than everything. Hiding some of it would drop a
    // project with nothing on screen saying so.
    const many: NavProject[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      title: `Project ${i}`,
      clientName: "Perks",
    }));

    expect(projectsNavGroup(USER_ROLES.ADMIN, many)?.items).toHaveLength(12);
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
});
