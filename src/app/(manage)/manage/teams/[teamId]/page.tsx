import ManageTeamDetailPage from "@/features/manage-teams/manage-team-detail.page";

// The team id is a routing parameter and nothing more. It is handed straight
// to the feature page, which passes it to a service that re-checks it against
// the signed-in manager's own teams before reading anything.
export default async function ManageTeam({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return <ManageTeamDetailPage teamId={teamId} />;
}
