"use client";

import { useMemo } from "react";

import { authClient } from "@/lib/auth/auth-client";
import { type UserRole } from "@/lib/data/kysely-database-types";

import { navGroupsForRole, withMyProjects, type NavGroup } from "./nav-items";
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
    // THE PERSON'S OWN PROJECTS, HUNG UNDER THE ROW THAT IS ALREADY THERE.
    //
    // This used to splice in a whole second GROUP, which is how the rail
    // ended up with a link called "All projects", a heading reading
    // "Projects" and a disclosure also reading "Projects" - three rows over
    // one list. The "Projects" entry now lives in the static tree with no
    // children, and this fills them in.
    //
    // ARRIVES LATE, AND NOTHING MOVES WHEN IT DOES. The projects are fetched
    // by MyProjectsProvider after the session resolves, so the sidebar paints
    // its static entries first. Because the row already exists, the children
    // unfold UNDERNEATH it rather than a new row appearing above whatever
    // somebody was reaching for.
    // -----------------------------------------------------------------
    return withMyProjects(
      groups,
      role as UserRole,
      projects.map((project) => ({
        id: project.id,
        title: project.title,
        clientName: project.clientName,
      })),
    );
  }, [isPending, role, projects]);
}
