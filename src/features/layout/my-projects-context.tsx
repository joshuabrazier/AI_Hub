"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { authClient } from "@/lib/auth/auth-client";
import { getMyProjectsAction } from "@/features/delivery/delivery-setup.actions";
import type { ProjectSummaryDTO } from "@/features/delivery/delivery.types";

// -------------------------------------------------------------------
// The signed-in person's own projects, for the sidebar.
//
// WHY THIS IS FETCHED AND NOT PASSED IN. The nav is rendered by AppShell in
// the ROOT layout - above all three areas, as a client component - so there
// is no server component in its tree to read for it. The alternative was
// reading in the root layout, which also wraps the public site and the
// sign-in page, and would have meant a projects query for every visitor who
// is not signed in.
//
// ONCE PER MOUNT, AND ONLY WHEN SIGNED IN. It waits for the session before
// asking, so a signed-out visitor never triggers it. AppShell mounts this
// inside the authenticated branch, so a chromeless route does not either.
//
// A FAILURE IS AN EMPTY LIST, NOT AN ERROR. The nav is display, and every
// route it points at is independently guarded - so the worst case of getting
// this wrong is a sidebar without the project shortcuts, which is exactly
// what the sidebar looked like before they existed. Rendering an error where
// a list of links should be would be worse than rendering nothing.
//
// IT DOES NOT REFETCH ON NAVIGATION. The list changes when somebody is added
// to a project, which is rare and done by somebody else; paying a query on
// every page transition to notice it sooner is the wrong trade. A refresh
// picks it up.
// -------------------------------------------------------------------
const MyProjectsContext = createContext<ProjectSummaryDTO[]>([]);

export function MyProjectsProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [projects, setProjects] = useState<ProjectSummaryDTO[]>([]);

  const userId = session?.user.id;

  useEffect(() => {
    // Nobody signed in yet - or nobody at all. Either way there is nothing to
    // ask about, and asking would be a request on the sign-in page.
    if (isPending || !userId) return;

    let cancelled = false;

    getMyProjectsAction()
      .then((response) => {
        if (cancelled) return;

        // A refusal leaves the list empty. See the note above.
        setProjects(response.success ? response.data : []);
      })
      .catch(() => {
        // Deliberately silent: this is the sidebar, and the page it decorates
        // is already rendered and working.
        if (!cancelled) setProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isPending, userId]);

  return <MyProjectsContext.Provider value={projects}>{children}</MyProjectsContext.Provider>;
}

/** The caller's own projects. Empty until they have loaded, and on any failure. */
export function useMyProjects(): ProjectSummaryDTO[] {
  return useContext(MyProjectsContext);
}
