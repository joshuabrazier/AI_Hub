import { redirect } from "next/navigation";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// The manager area's landing.
//
// IT REDIRECTS, BECAUSE THERE IS NOTHING LEFT FOR IT TO SUMMARISE. This used
// to render the teams overview - the manager's teams and their members - and
// teams have been removed from the base entirely. What the area actually
// holds now is projects, the timesheet, AI chat, summaries and transcription,
// and every one of those is scoped by something other than a team: a project
// by its membership, the rest by the session user.
//
// PROJECTS IS THE DESTINATION because it is the only one of the five that is
// about other people's work rather than the manager's own, which is what
// somebody opening the manager area came for. An empty landing page that
// existed only to hold links the sidebar already carries would be a screen
// nobody reads twice.
//
// THE GUARD IS STILL HERE, before the redirect. The area layout has one too,
// and this is not a duplicate for its own sake: a redirect performed without
// a role check tells an unauthorised caller where to go next, and the page it
// points at is one more request away from saying no.
// -------------------------------------------------------------------
export default async function Manage() {
  await requireUserRole([USER_ROLES.ADMIN, USER_ROLES.MANAGER]);

  redirect(ROUTES.MANAGE_PROJECTS);
}
