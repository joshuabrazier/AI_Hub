import PortalPage from "@/features/layout/portal-page";
import {
  DeliveryStatTiles,
  WaitingOnYouCard,
  YourWeekCard,
  type DeliveryHomeRoutes,
} from "@/features/delivery/components/delivery-home-cards";
import { getMyDeliverySummaryService } from "@/features/delivery/delivery-home.service";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

// -------------------------------------------------------------------
// The manager area's landing.
//
// IT USED TO REDIRECT TO PROJECTS, and that is why a manager had no Home row
// in the sidebar while an admin and a member both did: there was nothing for
// it to point at that Projects did not already say. Somebody moving between
// the three areas met the manager one as the odd one out.
//
// It renders the same delivery summary the other two homes open with - the
// week so far, and what is waiting - because that is the part of both of
// them that was never about a role. getMyDeliverySummaryService takes no
// role and no id: it resolves the caller from the session and scopes by
// project MEMBERSHIP, so an admin, a manager and a member all get their own
// work out of the same call.
//
// IT IS NOT PortalHomePage. That page looks right for this and cannot be
// reused: getPortalHomeService guards on [MEMBER], so a manager rendering it
// would be refused by a service whose only job is fetching a first name.
// Widening a member-scoped guard to get a greeting would be the wrong trade
// by a distance.
//
// The guard stays here as well as in the area layout, for the reason the
// redirect it replaced gave: the layout is one matcher change away from
// being the only gate.
// -------------------------------------------------------------------
const MANAGE_ROUTES: DeliveryHomeRoutes = {
  projects: ROUTES.MANAGE_PROJECTS,
  timesheet: ROUTES.MANAGE_TIMESHEET,
  board: (projectId) => ROUTES.manageProject(projectId),
};

export default async function Manage() {
  await requireUserRole([USER_ROLES.ADMIN, USER_ROLES.MANAGER]);

  const summary = await getMyDeliverySummaryService();

  return (
    <PortalPage
      eyebrow="Manager"
      title="Your work"
      description="Your week, and what is waiting for you."
    >
      <DeliveryStatTiles summary={summary} routes={MANAGE_ROUTES} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <WaitingOnYouCard summary={summary} routes={MANAGE_ROUTES} />

        {/* `today` comes from the APP's timezone, so the highlighted column is
            the organisation's day rather than the reader's. Nothing on this
            page constructs a Date. */}
        <YourWeekCard summary={summary} today={todayInAppZone()} routes={MANAGE_ROUTES} />
      </div>
    </PortalPage>
  );
}
