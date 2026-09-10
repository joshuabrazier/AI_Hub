"use client";

import { useMemo } from "react";

import { authClient } from "@/lib/auth/auth-client";
import { type UserRole } from "@/lib/data/kysely-database-types";

import { navGroupsForRole, projectsNavGroup, type NavGroup } from "./nav-items";
import { useMyProjects } from "./my-projects-context";

// -------------------------------------------------------------------
// The nav for the signed-in user.
//
// One lookup by role, and nothing else. The previous version filtered a single
// shared tree with per-item visibility predicates and rebuilt id-namespaced
// hrefs for the member area; both are gone. Each area now has its own tree in
// nav-items.tsx, and the member portal carries no id in its path, so there is
// nothing left to resolve at render time.
//
// Reading the role straight from the session rather than through a wrapper
// keeps this honest about where the value comes from: the nav is DISPLAY only,
// and every route it points at is independently guarded by the proxy and by
// its area layout. Hiding a link is not access control.
// -------------------------------------------------------------------
export function useNavGroups(): NavGroup[] {
  const { data: session, isPending } = authClient.useSession();
  const projects = useMyProjects();

  const role = session?.user.role;

  return useMemo(() => {
    // Render no nav until we know who is signed in. Falling back to a default
    // tree while the session loads would flash links for the wrong area.
    if (isPending || !role) return [];

    // An unrecognised role is handled by navGroupsForRole, which returns the
    // least privileged nav rather than guessing.
    const groups = navGroupsForRole(role as UserRole);

    // -----------------------------------------------------------------
    // THE PERSON'S OWN PROJECTS, SPLICED IN AFTER DELIVERY.
    //
    // Placed there rather than appended, because it belongs beside the
    // "All projects" link it overflows into - a group of boards at the very
    // bottom, under the account and settings entries, would read as an
    // afterthought.
    //
    // ARRIVES LATE AND THAT IS FINE. The projects are fetched by
    // MyProjectsProvider after the session resolves, so the sidebar renders
    // its static entries first and this group appears underneath a moment
    // later. Nothing moves that somebody was about to click: it is added
    // below the existing items, never inserted above them.
    // -----------------------------------------------------------------
    const projectGroup = projectsNavGroup(
      role as UserRole,
      projects.map((project) => ({
        id: project.id,
        title: project.title,
        clientName: project.clientName,
      })),
    );

    if (!projectGroup) return groups;

    const deliveryAt = groups.findIndex((group) => group.label === "Delivery");

    // Appended when there is no Delivery group to sit under, rather than
    // dropped - a nav tree that gains one later should not silently lose the
    // projects.
    if (deliveryAt === -1) return [...groups, projectGroup];

    return [...groups.slice(0, deliveryAt + 1), projectGroup, ...groups.slice(deliveryAt + 1)];
  }, [isPending, role, projects]);
}
