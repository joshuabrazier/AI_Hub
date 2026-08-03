import { LayoutPanelLeft } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { Card, CardContent } from "@/components/ui/card";

import { ManagedTeamCard } from "./components/managed-team-card";
import { getManagedTeamsService } from "./manage-teams.service";

// -------------------------------------------------------------------
// Manager teams list
//
// Only the teams the signed-in manager holds. The service resolves that set
// from the session, so there is no filter for this page to get wrong.
// -------------------------------------------------------------------
export default async function ManageTeamsPage() {
  const teams = await getManagedTeamsService();

  return (
    <PortalPage
      eyebrow="Manager"
      title="Teams"
      description="The teams you manage, and who belongs to them."
    >
      {teams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LayoutPanelLeft size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">No teams yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              An admin assigns you to a team. Once they do, it appears here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <ManagedTeamCard key={team.id} team={team} />
          ))}
        </div>
      )}
    </PortalPage>
  );
}
